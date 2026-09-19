"""Live session runtime: rolling embedding gallery + continuous scoring.

This implements the user lifecycle from design_choices.txt FILE 1, section 4:

    Phase 1  Cold start   first 30-60 s   collect 15-30 valid 128D vectors
                                          -> the in-memory Baseline Gallery
    Phase 2  Continuous   every 2 s       embed -> LightGBM -> risk 0.0-1.0
    Phase 3  Escalation   3x consecutive  risk >= threshold -> step-up auth

The generic Siamese encoder is frozen and shared by every user; nothing here
trains it. Only the per-session gallery and its LightGBM scorer are built live.

Gallery modes
-------------
``frozen`` (default)
    The first ``warmup_size`` vectors become the baseline and stay fixed. This
    is what the design document specifies.
``rolling``
    The gallery is a sliding window of the most recent vectors. Convenient for
    drift, but it also means an attacker who takes over gradually is absorbed
    into the baseline and never scores as anomalous. Offered for comparison,
    not recommended as a security default.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field, asdict

import numpy as np

from .encoder import embed
from .feature_extractor import N_FEATURES
from .scorer import (
    BACKGROUND_SIZE,
    ESCALATION_CYCLES,
    GALLERY_SIZE,
    SMOOTHING_WINDOW,
    UserRiskModel,
    _distance_stats,
    smooth_risk,
)

WARMUP_SECONDS_HINT = 2.0  # one window per 2 s, used for the countdown display
GALLERY_MODES = ("frozen", "rolling")


@dataclass
class LiveUpdate:
    """One 2-second tick of the live session."""

    index: int
    status: str                 # "warming" | "active"
    gallery_size: int
    warmup_remaining: int
    seconds_remaining: float
    risk: float | None          # None while warming up
    smoothed_risk: float | None
    threshold: float
    streak: int
    escalated: bool
    # "by how much" the window deviates from the gallery
    cos_min: float = 0.0
    cos_mean: float = 0.0
    cos_centroid: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


class LiveSession:
    """Per-session state: warm-up buffer, gallery, scorer and risk history."""

    def __init__(
        self,
        encoder,
        scaler,
        background: np.ndarray,
        warmup_size: int = GALLERY_SIZE,
        gallery_mode: str = "frozen",
        background_size: int = BACKGROUND_SIZE,
        smoothing: int = SMOOTHING_WINDOW,
        cycles: int = ESCALATION_CYCLES,
        threshold: float | None = None,
        seed: int = 0,
    ):
        if gallery_mode not in GALLERY_MODES:
            raise ValueError(f"gallery_mode must be one of {GALLERY_MODES}")
        if warmup_size < 2:
            raise ValueError("warmup_size must be >= 2")

        self.encoder = encoder
        self.scaler = scaler
        self.warmup_size = warmup_size
        self.gallery_mode = gallery_mode
        self.smoothing = smoothing
        self.cycles = cycles
        self.manual_threshold = threshold
        self.seed = seed

        rng = np.random.default_rng(seed)
        n = min(background_size, len(background))
        self.background = background[rng.choice(len(background), size=n, replace=False)]

        self.embeddings: deque[np.ndarray] = deque(maxlen=warmup_size)
        self.model: UserRiskModel | None = None
        self.threshold = threshold if threshold is not None else 0.80
        self.raw_history: list[float] = []
        self.index = 0
        self.streak = 0
        self.escalated = False

    # -- properties -------------------------------------------------------
    @property
    def status(self) -> str:
        return "active" if self.model is not None else "warming"

    @property
    def gallery(self) -> np.ndarray:
        return np.stack(list(self.embeddings)) if self.embeddings else np.empty((0, 0))

    # -- main entry point -------------------------------------------------
    def push_features(self, features: np.ndarray) -> LiveUpdate:
        """Feed one window of 32 features and get the updated risk state."""
        features = np.asarray(features, dtype=np.float32).reshape(1, -1)
        if features.shape[1] != N_FEATURES:
            raise ValueError(f"expected {N_FEATURES} features, got {features.shape[1]}")

        vector = embed(self.encoder, self.scaler.transform(features))[0]
        self.index += 1

        if self.model is None:
            return self._warm_up(vector)
        return self._score(vector)

    def _warm_up(self, vector: np.ndarray) -> LiveUpdate:
        self.embeddings.append(vector)
        if len(self.embeddings) >= self.warmup_size:
            self._build_model()
            # The vector that completed the gallery is part of the baseline,
            # so it is not scored; scoring starts with the next window.
        remaining = max(0, self.warmup_size - len(self.embeddings))
        return LiveUpdate(
            index=self.index,
            status=self.status,
            gallery_size=len(self.embeddings),
            warmup_remaining=remaining,
            seconds_remaining=remaining * WARMUP_SECONDS_HINT,
            risk=None,
            smoothed_risk=None,
            threshold=self.threshold,
            streak=0,
            escalated=False,
        )

    def _build_model(self) -> None:
        gallery = np.stack(list(self.embeddings))
        self.model = UserRiskModel("live", gallery).fit(self.background, seed=self.seed)
        if self.manual_threshold is None:
            self.threshold = self.model.calibrate_from_gallery(smoothing=self.smoothing)
        else:
            self.threshold = self.manual_threshold
            self.model.threshold = self.manual_threshold

    def _score(self, vector: np.ndarray) -> LiveUpdate:
        assert self.model is not None
        query = vector.reshape(1, -1)
        risk = float(self.model.risk(query)[0])
        self.raw_history.append(risk)

        smoothed = float(smooth_risk(np.asarray(self.raw_history), self.smoothing)[-1])
        self.streak = self.streak + 1 if smoothed >= self.threshold else 0
        if self.streak >= self.cycles:
            self.escalated = True

        stats = _distance_stats(query, self.model.gallery)[0]

        if self.gallery_mode == "rolling":
            self.embeddings.append(vector)
            self.model.gallery = np.stack(list(self.embeddings))

        return LiveUpdate(
            index=self.index,
            status=self.status,
            gallery_size=len(self.embeddings),
            warmup_remaining=0,
            seconds_remaining=0.0,
            risk=risk,
            smoothed_risk=smoothed,
            threshold=self.threshold,
            streak=self.streak,
            escalated=self.escalated,
            cos_min=float(stats[0]),
            cos_mean=float(stats[4]),
            cos_centroid=float(stats[6]),
        )

    def reset(self) -> None:
        self.embeddings.clear()
        self.model = None
        self.raw_history.clear()
        self.index = 0
        self.streak = 0
        self.escalated = False
        self.threshold = self.manual_threshold if self.manual_threshold is not None else 0.80
