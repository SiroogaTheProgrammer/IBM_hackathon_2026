"""Stage 2: per-user LightGBM anomaly scorer (design_choices.txt FILE 1, section 3).

At login the user's gallery vectors (class 0) are fitted against background
vectors from other users (class 1). Scoring a live window returns a risk score
in ``[0, 1]`` where >= 0.80 is a spike.
"""

from __future__ import annotations

import numpy as np
from lightgbm import LGBMClassifier

GALLERY_SIZE = 60
CALIBRATION_SIZE = 300
BACKGROUND_SIZE = 150
RISK_THRESHOLD = 0.80
ESCALATION_CYCLES = 3
SMOOTHING_WINDOW = 5
TARGET_FALSE_ALARM = 0.05

# Only distance-to-gallery statistics are used. Feeding the raw 128-D embedding
# to a classifier fitted on ~30 positives makes it memorise the gallery region
# and score every unseen genuine window as an impostor.
DISTANCE_FEATURES = (
    "cos_min", "cos_top3", "cos_p25", "cos_median", "cos_mean", "cos_std", "cos_centroid",
)
N_DISTANCE_FEATURES = len(DISTANCE_FEATURES)


def _distance_stats(queries: np.ndarray, gallery: np.ndarray, leave_one_out: bool = False) -> np.ndarray:
    """Cosine distance statistics of each query against the gallery.

    Embeddings are L2-normalised, so ``euclidean = sqrt(2 - 2 * cos_sim)`` is a
    monotone transform of the cosine distance and carries no extra information;
    only cosine-based statistics are kept.

    ``leave_one_out`` masks the diagonal, which is required when the queries
    *are* the gallery - otherwise every gallery row has a self-distance of 0 and
    the classifier learns a shortcut that does not exist at inference time.
    """
    queries = queries.astype(np.float64)
    gallery = gallery.astype(np.float64)
    n_gallery = gallery.shape[0]

    cos = 1.0 - queries @ gallery.T
    if leave_one_out:
        if queries.shape[0] != n_gallery:
            raise ValueError("leave_one_out requires queries to be the gallery")
        cos = np.where(np.eye(n_gallery, dtype=bool), np.nan, cos)

    # Distance to the gallery centroid. Under leave-one-out the centroid must
    # also exclude the query, otherwise it leaks into its own reference point.
    total = gallery.sum(axis=0)
    if leave_one_out:
        centroid = (total - queries) / max(n_gallery - 1, 1)
    else:
        centroid = np.broadcast_to(total / n_gallery, queries.shape)
    norm = np.linalg.norm(centroid, axis=1, keepdims=True)
    centroid = np.divide(centroid, norm, out=np.zeros_like(centroid), where=norm > 0)

    ordered = np.sort(cos, axis=1)  # NaNs sort to the end
    k = min(3, max(n_gallery - 1, 1))

    with np.errstate(invalid="ignore"):
        stats = np.column_stack(
            [
                ordered[:, 0],
                np.nanmean(ordered[:, :k], axis=1),
                np.nanpercentile(cos, 25, axis=1),
                np.nanmedian(cos, axis=1),
                np.nanmean(cos, axis=1),
                np.nanstd(cos, axis=1),
                1.0 - np.sum(queries * centroid, axis=1),
            ]
        )
    return np.nan_to_num(stats, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def smooth_risk(risk: np.ndarray, window: int = SMOOTHING_WINDOW) -> np.ndarray:
    """Causal trailing mean of the risk stream.

    Per-window scores are noisy, and a live system can only average over windows
    it has already seen, so this is a trailing (not centred) mean and the output
    keeps the same length as the input.
    """
    risk = np.asarray(risk, dtype=np.float64)
    if window <= 1 or risk.size == 0:
        return risk.astype(np.float32)
    cumulative = np.concatenate([[0.0], np.cumsum(risk)])
    index = np.arange(risk.size)
    start = np.maximum(0, index - window + 1)
    return ((cumulative[index + 1] - cumulative[start]) / (index - start + 1)).astype(np.float32)


class UserRiskModel:
    """Gallery + LightGBM risk scorer for a single enrolled user."""

    def __init__(self, user: str, gallery: np.ndarray):
        if gallery.ndim != 2 or gallery.shape[0] < 2:
            raise ValueError(f"user {user}: gallery needs >= 2 vectors")
        self.user = user
        self.gallery = gallery.astype(np.float32)
        self.threshold = RISK_THRESHOLD
        self._clf: LGBMClassifier | None = None

    def _build_inputs(self, embeddings: np.ndarray, leave_one_out: bool = False) -> np.ndarray:
        return _distance_stats(embeddings, self.gallery, leave_one_out=leave_one_out)

    def fit(
        self,
        background: np.ndarray,
        calibration: np.ndarray | None = None,
        seed: int = 0,
        target_false_alarm: float = TARGET_FALSE_ALARM,
        smoothing: int = SMOOTHING_WINDOW,
    ) -> "UserRiskModel":
        """Fit the gallery-vs-background classifier and calibrate the threshold.

        ``calibration`` holds genuine windows that are *not* in the gallery. The
        escalation threshold is set to the quantile of those scores that leaves
        ``target_false_alarm`` of the owner's own traffic above it; a fixed 0.80
        is meaningless because every user's score distribution is different.
        """
        genuine = self._build_inputs(self.gallery, leave_one_out=True)
        impostor = self._build_inputs(background.astype(np.float32))

        X = np.vstack([genuine, impostor])
        y = np.concatenate([np.zeros(len(genuine), int), np.ones(len(impostor), int)])

        self._clf = LGBMClassifier(
            n_estimators=200,
            learning_rate=0.05,
            num_leaves=7,
            min_child_samples=5,
            subsample=0.9,
            subsample_freq=1,
            colsample_bytree=0.7,
            class_weight="balanced",
            random_state=seed,
            verbose=-1,
        )
        self._clf.fit(X, y)

        if calibration is not None and len(calibration) > 0:
            scores = smooth_risk(self.risk(calibration), smoothing)
            self.threshold = float(
                np.clip(np.quantile(scores, 1.0 - target_false_alarm), 0.05, 0.999)
            )
        return self

    def calibrate_from_gallery(
        self,
        target_false_alarm: float = TARGET_FALSE_ALARM,
        smoothing: int = SMOOTHING_WINDOW,
    ) -> float:
        """Calibrate the threshold from the gallery itself, leave-one-out.

        Used in live mode, where the only genuine data available after warm-up
        *is* the gallery. Leave-one-out keeps each vector out of its own
        reference set, so the scores are not trivially zero-distance.
        """
        if self._clf is None:
            raise RuntimeError("UserRiskModel.fit() must be called before calibrate()")
        inputs = self._build_inputs(self.gallery, leave_one_out=True)
        scores = smooth_risk(self._clf.predict_proba(inputs)[:, 1], smoothing)
        self.threshold = float(
            np.clip(np.quantile(scores, 1.0 - target_false_alarm), 0.05, 0.999)
        )
        return self.threshold

    def risk(self, embeddings: np.ndarray) -> np.ndarray:
        """Risk score per window: 0.0 = looks like the owner, 1.0 = impostor."""
        if self._clf is None:
            raise RuntimeError("UserRiskModel.fit() must be called before risk()")
        if embeddings.shape[0] == 0:
            return np.empty((0,), np.float32)
        proba = self._clf.predict_proba(self._build_inputs(embeddings))
        return proba[:, 1].astype(np.float32)


def build_gallery_and_background(
    embeddings: np.ndarray,
    labels: np.ndarray,
    user: str,
    gallery_size: int = GALLERY_SIZE,
    background_size: int = BACKGROUND_SIZE,
    calibration_size: int = CALIBRATION_SIZE,
    seed: int = 0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split enrolment data into gallery, calibration and background sets.

    Calibration windows are the user's own, drawn disjointly from the gallery so
    the threshold is not calibrated on rows the classifier trained on.
    """
    rng = np.random.default_rng(seed)

    own = np.flatnonzero(labels == user)
    other = np.flatnonzero(labels != user)
    if own.size < 2:
        raise ValueError(f"user {user}: not enough enrolment windows ({own.size})")

    shuffled = rng.permutation(own)
    n_gallery = min(gallery_size, shuffled.size)
    gallery_idx = shuffled[:n_gallery]
    calibration_idx = shuffled[n_gallery : n_gallery + calibration_size]
    background_idx = rng.choice(other, size=min(background_size, other.size), replace=False)
    return embeddings[gallery_idx], embeddings[calibration_idx], embeddings[background_idx]


def escalation_triggered(
    risk_scores: np.ndarray,
    threshold: float = RISK_THRESHOLD,
    cycles: int = ESCALATION_CYCLES,
    smoothing: int = 1,
) -> bool:
    """True when the risk score stays >= threshold for N consecutive windows."""
    scores = smooth_risk(risk_scores, smoothing) if smoothing > 1 else risk_scores
    streak = 0
    for score in scores:
        streak = streak + 1 if score >= threshold else 0
        if streak >= cycles:
            return True
    return False
