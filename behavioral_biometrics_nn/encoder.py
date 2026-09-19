"""Stage 1: the generic Siamese base model (design_choices.txt FILE 1, section 3).

This encoder is trained ONCE on ``training_files`` and is deliberately
**user-agnostic**: it learns a metric space where windows from the same person
land close together. It is never re-trained per user - at login the per-user
LightGBM in :mod:`behavioral_biometrics_nn.scorer` is fitted on top of the
frozen embeddings.

Architecture (exactly as specified)::

    Input(32) -> Dense(64, ReLU) -> Dense(128, ReLU) -> Dense(128, Linear) -> L2 Norm

Training loss
-------------
Pure batch-hard triplet loss collapses on this data: every embedding converges
to a single point, the loss pins itself to the margin, and the mean pairwise
distance drops to ~0.006 out of a possible 2.0. To keep the triplet objective
from the design while staying stable, training combines:

* batch-all triplet loss averaged over *active* triplets only, and
* an auxiliary normalised-softmax (cosine) classification head.

The auxiliary head cannot be satisfied by a collapsed embedding (identical
vectors give identical logits for every identity), so it acts as a collapse
guard. It is discarded after training - only the encoder is saved.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

EMBEDDING_DIM = 128
COLLAPSE_DISTANCE_THRESHOLD = 0.05


def signed_log1p(X: np.ndarray) -> np.ndarray:
    """Tame the heavy tails of velocity/acceleration/jerk maxima."""
    return np.sign(X) * np.log1p(np.abs(X))


class FeatureScaler:
    """signed-log1p -> standardise -> clip. Fitted on training windows only."""

    def __init__(self, clip: float = 5.0):
        self.clip = float(clip)
        self.mean_: np.ndarray | None = None
        self.scale_: np.ndarray | None = None

    def fit(self, X: np.ndarray) -> "FeatureScaler":
        Z = signed_log1p(X.astype(np.float64))
        self.mean_ = Z.mean(axis=0)
        scale = Z.std(axis=0)
        # constant columns (e.g. the keyboard slots on mouse-only data) -> 1.0
        self.scale_ = np.where(scale > 1e-9, scale, 1.0)
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        if self.mean_ is None or self.scale_ is None:
            raise RuntimeError("FeatureScaler.fit() must be called first")
        Z = (signed_log1p(X.astype(np.float64)) - self.mean_) / self.scale_
        return np.clip(Z, -self.clip, self.clip).astype(np.float32)

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        return self.fit(X).transform(X)

    def save(self, path) -> None:
        np.savez(path, mean=self.mean_, scale=self.scale_, clip=np.array(self.clip))

    @classmethod
    def load(cls, path) -> "FeatureScaler":
        data = np.load(path)
        scaler = cls(clip=float(data["clip"]))
        scaler.mean_ = data["mean"]
        scaler.scale_ = data["scale"]
        return scaler


class SiameseEncoder(nn.Module):
    def __init__(self, input_dim: int = 32, embedding_dim: int = EMBEDDING_DIM):
        super().__init__()
        self.input_dim = input_dim
        self.embedding_dim = embedding_dim
        self.net = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 128),
            nn.ReLU(),
            nn.Linear(128, embedding_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.normalize(self.net(x), p=2, dim=1)


class _CosineHead(nn.Module):
    """Auxiliary normalised-softmax head, used during training only."""

    def __init__(self, embedding_dim: int, n_classes: int, scale: float = 30.0):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(n_classes, embedding_dim) * 0.01)
        self.scale = scale

    def forward(self, embeddings: torch.Tensor) -> torch.Tensor:
        return self.scale * embeddings @ F.normalize(self.weight, p=2, dim=1).t()


def batch_hard_triplet_loss(
    embeddings: torch.Tensor, labels: torch.Tensor, margin: float = 0.2
) -> torch.Tensor:
    """Hardest-positive / hardest-negative triplet loss (kept for reference/tests)."""
    dist = torch.cdist(embeddings, embeddings, p=2)
    same = labels[:, None] == labels[None, :]
    eye = torch.eye(labels.numel(), dtype=torch.bool, device=labels.device)

    pos_mask = same & ~eye
    neg_mask = ~same

    hardest_pos = dist.masked_fill(~pos_mask, float("-inf")).max(dim=1).values
    hardest_neg = dist.masked_fill(~neg_mask, float("inf")).min(dim=1).values

    valid = pos_mask.any(dim=1) & neg_mask.any(dim=1)
    if not bool(valid.any()):
        return embeddings.sum() * 0.0
    return torch.relu(hardest_pos[valid] - hardest_neg[valid] + margin).mean()


def batch_all_triplet_loss(
    embeddings: torch.Tensor, labels: torch.Tensor, margin: float = 0.3
) -> torch.Tensor:
    """Mean over *active* (loss > 0) triplets - far less collapse-prone."""
    dist = torch.cdist(embeddings, embeddings, p=2)
    same = labels[:, None] == labels[None, :]
    eye = torch.eye(labels.numel(), dtype=torch.bool, device=labels.device)

    pos_mask = (same & ~eye)[:, :, None]
    neg_mask = (~same)[:, None, :]
    valid = pos_mask & neg_mask

    losses = torch.relu(dist[:, :, None] - dist[:, None, :] + margin) * valid
    active = (losses > 1e-12).sum()
    if active == 0:
        return embeddings.sum() * 0.0
    return losses.sum() / active


def _pk_batch(
    by_label: dict[int, np.ndarray], rng: np.random.Generator, n_users: int, per_user: int
) -> np.ndarray:
    labels = list(by_label)
    n_users = min(n_users, len(labels))
    chosen = rng.choice(labels, size=n_users, replace=False)
    idx = []
    for label in chosen:
        pool = by_label[int(label)]
        idx.append(rng.choice(pool, size=per_user, replace=pool.size < per_user))
    return np.concatenate(idx)


@torch.no_grad()
def mean_pairwise_distance(embeddings: np.ndarray, sample: int = 1500, seed: int = 0) -> float:
    """Collapse metric: ~0 means every window maps to the same point."""
    if len(embeddings) < 2:
        return 0.0
    rng = np.random.default_rng(seed)
    if len(embeddings) > sample:
        embeddings = embeddings[rng.choice(len(embeddings), size=sample, replace=False)]
    sim = embeddings @ embeddings.T
    dist = np.sqrt(np.maximum(2.0 - 2.0 * sim, 0.0))
    iu = np.triu_indices(len(embeddings), k=1)
    return float(dist[iu].mean())


def train_encoder(
    X: np.ndarray,
    y: np.ndarray,
    epochs: int = 30,
    steps_per_epoch: int = 60,
    users_per_batch: int = 8,
    windows_per_user: int = 12,
    learning_rate: float = 1e-3,
    margin: float = 0.3,
    triplet_weight: float = 1.0,
    embedding_dim: int = EMBEDDING_DIM,
    seed: int = 0,
    verbose: bool = True,
) -> SiameseEncoder:
    """Pre-train the generic encoder on scaled training windows.

    ``embedding_dim`` defaults to the 128-D mouse layout but can be lowered
    for a smaller feature space (e.g. the 6-D keystroke extension), since the
    encoder architecture and every downstream artifact/scoring path are fully
    generic over both ``input_dim`` and ``embedding_dim``.
    """
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)

    users = sorted(set(y.tolist()))
    user_to_idx = {u: i for i, u in enumerate(users)}
    labels = np.array([user_to_idx[u] for u in y], dtype=np.int64)
    by_label = {i: np.flatnonzero(labels == i) for i in range(len(users))}
    by_label = {k: v for k, v in by_label.items() if v.size > 1}
    if len(by_label) < 2:
        raise ValueError("Triplet training needs at least 2 users with >1 window each")

    X_t = torch.from_numpy(X.astype(np.float32))
    y_t = torch.from_numpy(labels)

    model = SiameseEncoder(input_dim=X.shape[1], embedding_dim=embedding_dim)
    head = _CosineHead(model.embedding_dim, len(users))
    optimizer = torch.optim.Adam(
        list(model.parameters()) + list(head.parameters()), lr=learning_rate
    )

    model.train()
    for epoch in range(1, epochs + 1):
        totals = np.zeros(3)
        for _ in range(steps_per_epoch):
            idx = _pk_batch(by_label, rng, users_per_batch, windows_per_user)
            batch_x, batch_y = X_t[idx], y_t[idx]

            optimizer.zero_grad()
            emb = model(batch_x)
            t_loss = batch_all_triplet_loss(emb, batch_y, margin)
            c_loss = F.cross_entropy(head(emb), batch_y)
            loss = triplet_weight * t_loss + c_loss
            loss.backward()
            optimizer.step()
            totals += [float(loss.item()), float(t_loss.item()), float(c_loss.item())]

        if verbose and (epoch % 5 == 0 or epoch == 1):
            total, trip, cls = totals / steps_per_epoch
            print(f"  epoch {epoch:>3}/{epochs}  loss={total:.4f}  triplet={trip:.4f}  cls={cls:.4f}")

    model.eval()

    spread = mean_pairwise_distance(embed(model, X[: min(len(X), 20000)]))
    if verbose:
        print(f"  embedding mean pairwise distance = {spread:.4f}")
    if spread < COLLAPSE_DISTANCE_THRESHOLD:
        raise RuntimeError(
            f"Encoder collapsed (mean pairwise distance {spread:.4f} < "
            f"{COLLAPSE_DISTANCE_THRESHOLD}). Embeddings carry no information."
        )
    return model


@torch.no_grad()
def embed(model: SiameseEncoder, X: np.ndarray, batch_size: int = 4096) -> np.ndarray:
    """Map scaled 32-feature windows to L2-normalised 128D vectors."""
    model.eval()
    out = []
    for start in range(0, len(X), batch_size):
        chunk = torch.from_numpy(X[start : start + batch_size].astype(np.float32))
        out.append(model(chunk).numpy())
    if not out:
        return np.empty((0, model.embedding_dim), np.float32)
    return np.concatenate(out, axis=0)


# --------------------------------------------------------------------------
# artifact persistence
# --------------------------------------------------------------------------

def save_base_model(
    directory,
    encoder: SiameseEncoder,
    scaler: FeatureScaler,
    background: np.ndarray,
    background_users: np.ndarray,
    meta: dict | None = None,
) -> Path:
    """Persist everything needed to enrol a new user later.

    The checkpoint bundle is intentionally explicit and production-friendly: it
    stores the model weights, scaler state, background embeddings and a JSON
    metadata file that can be reloaded without any additional ad hoc logic.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)

    torch.save({
        "state_dict": encoder.state_dict(),
        "input_dim": encoder.input_dim,
        "embedding_dim": encoder.embedding_dim,
        "model_class": SiameseEncoder.__name__,
    }, directory / "encoder.pt")
    scaler.save(directory / "scaler.npz")
    np.save(directory / "background_embeddings.npy", background.astype(np.float32))
    np.save(directory / "background_users.npy", background_users.astype(str))

    payload = {
        "input_dim": encoder.input_dim,
        "embedding_dim": encoder.embedding_dim,
        "n_background": int(background.shape[0]),
        "format_version": 2,
        "model_name": SiameseEncoder.__name__,
        **(meta or {}),
    }
    (directory / "base_model.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return directory


def export_siamese_weights(model: SiameseEncoder, path) -> Path:
    """Write a clean state_dict-only checkpoint suitable for separate reuse."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out)
    return out


def load_base_model(directory):
    """Return ``(encoder, scaler, background, background_users, meta)``."""
    directory = Path(directory)
    meta_path = directory / "base_model.json"
    if not meta_path.exists():
        raise FileNotFoundError(
            f"No trained base model in {directory}. Run train_base_model.py first."
        )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

    encoder = SiameseEncoder(meta["input_dim"], meta["embedding_dim"])
    weights = torch.load(directory / "encoder.pt", map_location="cpu")
    if isinstance(weights, dict) and "state_dict" in weights:
        encoder.load_state_dict(weights["state_dict"])
    else:
        encoder.load_state_dict(weights)
    encoder.eval()

    scaler = FeatureScaler.load(directory / "scaler.npz")
    background = np.load(directory / "background_embeddings.npy")
    background_users = np.load(directory / "background_users.npy", allow_pickle=True).astype(str)
    return encoder, scaler, background, background_users, meta
