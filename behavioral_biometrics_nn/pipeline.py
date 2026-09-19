"""Pipeline stages.

Stage A (``train_base_model``): train the generic Siamese encoder on
``training_files`` and save it to an artifacts directory. Run once.

Stage B (``evaluate``): load the saved base model, enrol each user from their
training sessions, then score ``test_files`` and write metrics.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score, roc_curve

from .dataset import SessionWindows, load_sessions_cached, stack_windows
from .encoder import (
    FeatureScaler,
    embed,
    load_base_model,
    mean_pairwise_distance,
    save_base_model,
    train_encoder,
)
from .scorer import (
    BACKGROUND_SIZE,
    CALIBRATION_SIZE,
    ESCALATION_CYCLES,
    GALLERY_SIZE,
    SMOOTHING_WINDOW,
    UserRiskModel,
    build_gallery_and_background,
    escalation_triggered,
    smooth_risk,
)

DEFAULT_ARTIFACTS = "artifacts"
DEFAULT_CACHE = "artifacts/cache"
BACKGROUND_BANK_SIZE = 4000


@dataclass
class UserResult:
    user: str
    n_genuine: int
    n_impostor: int
    roc_auc: float
    roc_auc_smoothed: float
    session_auc: float
    eer: float
    threshold: float
    false_lockout_rate: float
    detection_rate: float


@dataclass
class EvaluationResult:
    per_user: list[UserResult] = field(default_factory=list)
    identification_accuracy: float = 0.0
    n_test_windows: int = 0

    @property
    def mean_auc(self) -> float:
        return float(np.mean([r.roc_auc for r in self.per_user])) if self.per_user else 0.0

    @property
    def mean_auc_smoothed(self) -> float:
        return float(np.mean([r.roc_auc_smoothed for r in self.per_user])) if self.per_user else 0.0

    @property
    def mean_session_auc(self) -> float:
        return float(np.mean([r.session_auc for r in self.per_user])) if self.per_user else 0.0

    @property
    def mean_eer(self) -> float:
        return float(np.mean([r.eer for r in self.per_user])) if self.per_user else 0.0

    @property
    def mean_false_lockout(self) -> float:
        return (
            float(np.mean([r.false_lockout_rate for r in self.per_user])) if self.per_user else 0.0
        )

    @property
    def mean_detection(self) -> float:
        return float(np.mean([r.detection_rate for r in self.per_user])) if self.per_user else 0.0

    def to_dict(self) -> dict:
        return {
            "identification_accuracy": self.identification_accuracy,
            "n_test_windows": self.n_test_windows,
            "mean_auc": self.mean_auc,
            "mean_auc_smoothed": self.mean_auc_smoothed,
            "mean_session_auc": self.mean_session_auc,
            "mean_eer": self.mean_eer,
            "mean_false_lockout_rate": self.mean_false_lockout,
            "mean_detection_rate": self.mean_detection,
            "per_user": [asdict(r) for r in self.per_user],
        }


def _equal_error_rate(y_true: np.ndarray, scores: np.ndarray) -> float:
    fpr, tpr, _ = roc_curve(y_true, scores)
    fnr = 1.0 - tpr
    idx = int(np.nanargmin(np.abs(fnr - fpr)))
    return float((fpr[idx] + fnr[idx]) / 2.0)


# --------------------------------------------------------------------------
# Stage A - generic base model
# --------------------------------------------------------------------------

def train_base_model(
    train_root,
    artifacts_dir=DEFAULT_ARTIFACTS,
    cache_dir=DEFAULT_CACHE,
    cache_name: str = "train_windows.npz",
    epochs: int = 30,
    max_sessions_per_user: int | None = None,
    seed: int = 0,
    refresh_cache: bool = False,
    verbose: bool = True,
) -> Path:
    """``train_root`` may be a single session-file directory or a list of them
    (e.g. ``["training_files", "test_files"]``) to pool more per-user data.
    """
    if verbose:
        print("[1/3] Loading training sessions ...")
    sessions = load_sessions_cached(
        train_root,
        cache_path=Path(cache_dir) / cache_name if cache_dir else None,
        refresh=refresh_cache,
        max_sessions_per_user=max_sessions_per_user,
        seed=seed,
        verbose=verbose,
    )
    X_raw, y = stack_windows(sessions)
    if X_raw.shape[0] == 0:
        raise RuntimeError(f"No usable training windows found under {train_root}")

    if verbose:
        print(f"[2/3] Training generic Siamese encoder on {X_raw.shape[0]} windows ...")
    scaler = FeatureScaler().fit(X_raw)
    X = scaler.transform(X_raw)
    encoder = train_encoder(X, y, epochs=epochs, seed=seed, verbose=verbose)

    if verbose:
        print("[3/3] Saving base model ...")
    embeddings = embed(encoder, X)

    rng = np.random.default_rng(seed)
    n_bank = min(BACKGROUND_BANK_SIZE, len(embeddings))
    bank_idx = rng.choice(len(embeddings), size=n_bank, replace=False)

    out = save_base_model(
        artifacts_dir,
        encoder,
        scaler,
        embeddings[bank_idx],
        np.asarray(y)[bank_idx],
        meta={
            "train_root": [str(r) for r in train_root] if isinstance(train_root, (list, tuple)) else str(train_root),
            "n_train_windows": int(X_raw.shape[0]),
            "n_train_sessions": len(sessions),
            "train_users": sorted(set(y.tolist())),
            "epochs": epochs,
            "embedding_spread": mean_pairwise_distance(embeddings),
        },
    )
    if verbose:
        print(f"  saved -> {out.resolve()}")
    return out


# --------------------------------------------------------------------------
# Stage B - enrolment + evaluation
# --------------------------------------------------------------------------

def enrol_users(
    encoder,
    scaler,
    train_sessions: list[SessionWindows],
    gallery_size: int = GALLERY_SIZE,
    background_size: int = BACKGROUND_SIZE,
    calibration_size: int = CALIBRATION_SIZE,
    smoothing: int = SMOOTHING_WINDOW,
    seed: int = 0,
) -> tuple[dict[str, UserRiskModel], dict[str, np.ndarray]]:
    X_raw, y = stack_windows(train_sessions)
    embeddings = embed(encoder, scaler.transform(X_raw))

    models: dict[str, UserRiskModel] = {}
    centroids: dict[str, np.ndarray] = {}
    for user in sorted(set(y.tolist())):
        gallery, calibration, background = build_gallery_and_background(
            embeddings, y, user, gallery_size, background_size, calibration_size, seed=seed
        )
        models[user] = UserRiskModel(user, gallery).fit(
            background, calibration=calibration, seed=seed, smoothing=smoothing
        )
        centroid = gallery.mean(axis=0)
        norm = float(np.linalg.norm(centroid))
        centroids[user] = centroid / norm if norm > 0 else centroid
    return models, centroids


def evaluate(
    train_root,
    test_root,
    artifacts_dir=DEFAULT_ARTIFACTS,
    cache_dir=DEFAULT_CACHE,
    max_train_sessions_per_user: int | None = None,
    max_test_sessions_per_user: int | None = 15,
    max_impostor_sessions: int = 40,
    gallery_size: int = GALLERY_SIZE,
    background_size: int = BACKGROUND_SIZE,
    calibration_size: int = CALIBRATION_SIZE,
    risk_threshold: float | None = None,
    escalation_cycles: int = ESCALATION_CYCLES,
    smoothing: int = SMOOTHING_WINDOW,
    seed: int = 0,
    refresh_cache: bool = False,
    verbose: bool = True,
) -> EvaluationResult:
    rng = np.random.default_rng(seed)
    encoder, scaler, _, _, _ = load_base_model(artifacts_dir)

    if verbose:
        print("[1/4] Loading enrolment sessions ...")
    train_sessions = load_sessions_cached(
        train_root,
        cache_path=Path(cache_dir) / "train_windows.npz" if cache_dir else None,
        refresh=refresh_cache,
        max_sessions_per_user=max_train_sessions_per_user,
        seed=seed,
        verbose=verbose,
    )

    if verbose:
        print("[2/4] Enrolling users (gallery + LightGBM) ...")
    models, centroids = enrol_users(
        encoder, scaler, train_sessions, gallery_size, background_size,
        calibration_size, smoothing, seed,
    )

    if verbose:
        print("[3/4] Loading test sessions ...")
    tag = max_test_sessions_per_user or "all"
    test_sessions = load_sessions_cached(
        test_root,
        cache_path=Path(cache_dir) / f"test_windows_{tag}.npz" if cache_dir else None,
        refresh=refresh_cache,
        max_sessions_per_user=max_test_sessions_per_user,
        seed=seed,
        verbose=verbose,
    )
    X_test_raw, y_test = stack_windows(test_sessions)
    if X_test_raw.shape[0] == 0:
        raise RuntimeError(f"No usable test windows found under {test_root}")
    test_emb = embed(encoder, scaler.transform(X_test_raw))

    if verbose:
        print("[4/4] Scoring genuine vs impostor windows ...")
    result = EvaluationResult(n_test_windows=int(X_test_raw.shape[0]))

    users = sorted(centroids)
    centroid_matrix = np.stack([centroids[u] for u in users])
    predicted = np.asarray(users)[np.argmax(test_emb @ centroid_matrix.T, axis=1)]
    result.identification_accuracy = float(np.mean(predicted == y_test))

    offsets: dict[int, tuple[int, int]] = {}
    cursor = 0
    for i, session in enumerate(test_sessions):
        offsets[i] = (cursor, cursor + len(session))
        cursor += len(session)

    for user, model in models.items():
        threshold = model.threshold if risk_threshold is None else risk_threshold

        own = [i for i, s in enumerate(test_sessions) if s.user == user]
        foreign = [i for i, s in enumerate(test_sessions) if s.user != user]
        if not own or not foreign:
            continue
        sampled = rng.choice(
            foreign, size=min(max_impostor_sessions, len(foreign)), replace=False
        ).tolist()

        # Score every relevant session exactly once; smoothing must stay inside
        # a session because there is no continuity across session boundaries.
        raw = {i: model.risk(test_emb[slice(*offsets[i])]) for i in own + sampled}
        smoothed = {i: smooth_risk(r, smoothing) for i, r in raw.items()}

        genuine_raw = np.concatenate([raw[i] for i in own])
        impostor_raw = np.concatenate([raw[i] for i in sampled])
        truth = np.concatenate(
            [np.zeros(genuine_raw.size, int), np.ones(impostor_raw.size, int)]
        )
        window_scores = np.concatenate([genuine_raw, impostor_raw])
        smoothed_scores = np.concatenate(
            [np.concatenate([smoothed[i] for i in own]),
             np.concatenate([smoothed[i] for i in sampled])]
        )

        session_scores = np.array([float(smoothed[i].mean()) for i in own + sampled])
        session_truth = np.concatenate([np.zeros(len(own), int), np.ones(len(sampled), int)])

        false_lockouts = sum(
            escalation_triggered(raw[i], threshold, escalation_cycles, smoothing) for i in own
        )
        detections = sum(
            escalation_triggered(raw[i], threshold, escalation_cycles, smoothing) for i in sampled
        )

        result.per_user.append(
            UserResult(
                user=user,
                n_genuine=int(genuine_raw.size),
                n_impostor=int(impostor_raw.size),
                roc_auc=float(roc_auc_score(truth, window_scores)),
                roc_auc_smoothed=float(roc_auc_score(truth, smoothed_scores)),
                session_auc=float(roc_auc_score(session_truth, session_scores)),
                eer=_equal_error_rate(truth, window_scores),
                threshold=float(threshold),
                false_lockout_rate=false_lockouts / len(own),
                detection_rate=detections / len(sampled),
            )
        )

    return result


def save_evaluation(result: EvaluationResult, artifacts_dir=DEFAULT_ARTIFACTS) -> Path:
    directory = Path(artifacts_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "metrics.json").write_text(
        json.dumps(result.to_dict(), indent=2), encoding="utf-8"
    )
    (directory / "report.txt").write_text(format_report(result), encoding="utf-8")
    return directory / "metrics.json"


def format_report(result: EvaluationResult) -> str:
    width = 96
    lines = [
        "",
        "=" * width,
        "Continuous Behavioral Biometrics - evaluation",
        "=" * width,
        f"test windows: {result.n_test_windows}",
        "closed-set identification accuracy (nearest gallery centroid): "
        f"{result.identification_accuracy:.3f}",
        "",
        f"{'user':<10}{'genuine':>9}{'impostor':>10}{'AUC':>8}{'AUCsm':>8}{'sessAUC':>9}"
        f"{'EER':>8}{'thresh':>9}{'false-lock':>12}{'detect':>9}",
        "-" * width,
    ]
    for r in sorted(result.per_user, key=lambda r: r.user):
        lines.append(
            f"{r.user:<10}{r.n_genuine:>9}{r.n_impostor:>10}{r.roc_auc:>8.3f}"
            f"{r.roc_auc_smoothed:>8.3f}{r.session_auc:>9.3f}{r.eer:>8.3f}"
            f"{r.threshold:>9.3f}{r.false_lockout_rate:>12.3f}{r.detection_rate:>9.3f}"
        )
    lines += [
        "-" * width,
        f"{'MEAN':<10}{'':>9}{'':>10}{result.mean_auc:>8.3f}{result.mean_auc_smoothed:>8.3f}"
        f"{result.mean_session_auc:>9.3f}{result.mean_eer:>8.3f}{'':>9}"
        f"{result.mean_false_lockout:>12.3f}{result.mean_detection:>9.3f}",
        "",
        "AUC     = per-window verification (1.0 perfect, 0.5 chance).",
        "AUCsm   = same, on the rolling-mean risk stream.",
        "sessAUC = per-session, using each session's mean smoothed risk.",
        "thresh  = per-user escalation threshold calibrated at enrolment.",
        "false-lock = genuine sessions wrongly escalated to 2FA (lower is better).",
        "detect     = impostor sessions escalated to 2FA (higher is better).",
        "=" * width,
    ]
    return "\n".join(lines)
