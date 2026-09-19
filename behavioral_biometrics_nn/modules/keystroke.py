"""Extension: keystroke dynamics (dwell / flight / rhythm).

Primary path (once ``train_keystroke_model.py`` has been run): a population-
pretrained Siamese encoder maps each ~1 s typing window to an embedding; a
per-session gallery is built during warm-up and later windows are scored by
cosine-distance-to-gallery - reusing the *exact same* ``LiveSession`` +
``UserRiskModel`` machinery as :class:`~behavioral_biometrics_nn.modules.
mouse.MouseBaseModule`. This is late fusion: the encoder, artifacts and
warm-up/gallery lifecycle are entirely separate from the mouse base model, and
adding/removing this module never touches the composite engine or the 32-D
mouse feature vector.

Fallback: if ``artifacts/keystroke/`` has not been trained yet, the module
degrades to a pure online z-score baseline learned during warm-up, so the demo
still works before ``train_keystroke_model.py`` is run.
"""

from __future__ import annotations

import math
from pathlib import Path
from statistics import fmean, pstdev

import numpy as np

from ..encoder import load_base_model
from ..feature_extractor import WINDOW_SECONDS
from ..live import LiveSession
from .base import STATUS_ACTIVE, STATUS_WARMING, ModuleResult, RiskModule

KEYSTROKE_ARTIFACTS_DIR = Path(__file__).resolve().parent.parent.parent / "artifacts" / "keystroke"
KEYSTROKE_WARMUP_SIZE = 20
MIN_KEYS_PER_WINDOW = 4
KEYS_FOR_FULL_CONFIDENCE = 6  # ~72 WPM; reaching this in a 1 s window gives full authority
WARMUP_KEYS = 40  # legacy fallback only

# The corpus used to pretrain the encoder spells special keys as "BKSP"/
# "DELETE" (see keystroke_dataset.py); the live browser telemetry instead
# reports KeyboardEvent.key names. Two different sources, same intent.
CORRECTION_KEYS = frozenset({"Backspace", "Delete"})


class KeystrokeModule(RiskModule):
    plugin_id = "keystroke_v1"
    display_name = "Keystroke dynamics"
    default_weight = 0.5

    def __init__(self, artifacts_dir=KEYSTROKE_ARTIFACTS_DIR, warmup_keys: int = WARMUP_KEYS):
        self.warmup_keys = warmup_keys
        self.session: LiveSession | None = None
        try:
            encoder, scaler, background, _, _ = load_base_model(artifacts_dir)
            self.session = LiveSession(
                encoder,
                scaler,
                background,
                warmup_size=KEYSTROKE_WARMUP_SIZE,
                seconds_per_window=WINDOW_SECONDS,
            )
        except FileNotFoundError:
            self.session = None  # pretrained model not built yet -> fall back
        self.reset()

    def reset(self) -> None:
        self.dwell_baseline: list[float] = []
        self.flight_baseline: list[float] = []
        self.n_keys = 0
        if self.session is not None:
            self.session.reset()

    def update(self, telemetry: dict) -> ModuleResult:
        keys = telemetry.get("keys", [])
        dwells = [float(k["dwell"]) for k in keys if _is_number(k.get("dwell"))]
        flights = [float(k["flight"]) for k in keys if _is_number(k.get("flight"))]

        if len(dwells) < MIN_KEYS_PER_WINDOW:
            return self.inactive(f"only {len(dwells)} keystrokes (need {MIN_KEYS_PER_WINDOW})")

        corrections = sum(1 for k in keys if str(k.get("key", "")) in CORRECTION_KEYS)
        # Previously scaled to 2x MIN_KEYS_PER_WINDOW, which needed ~8 keys/s
        # (near 90 WPM) before the module ever reached full authority - most
        # normal typing bursts stayed diluted to a fraction of its weight in
        # the composite average. KEYS_FOR_FULL_CONFIDENCE reflects a realistic
        # fast-typing rate instead.
        confidence = min(1.0, len(dwells) / KEYS_FOR_FULL_CONFIDENCE)

        if self.session is not None:
            return self._update_pretrained(dwells, flights, corrections, len(keys), confidence)
        return self._update_legacy(dwells, flights, corrections, len(keys), confidence)

    # -- primary path: pretrained embedding + per-session gallery ----------
    def _update_pretrained(
        self, dwells: list[float], flights: list[float], corrections: int, n_keys: int,
        confidence: float,
    ) -> ModuleResult:
        assert self.session is not None
        features = np.array(
            [
                fmean(dwells),
                pstdev(dwells) if len(dwells) > 1 else 0.0,
                fmean(flights) if flights else 0.0,
                pstdev(flights) if len(flights) > 1 else 0.0,
                n_keys / WINDOW_SECONDS,
                corrections / max(n_keys, 1),
            ],
            dtype=np.float32,
        )
        update = self.session.push_features(features)

        if update.risk is None:
            return ModuleResult(
                self.plugin_id, 0.0, 0.0, STATUS_WARMING,
                {
                    "gallery_size": update.gallery_size,
                    "warmup_remaining": update.warmup_remaining,
                    "seconds_remaining": update.seconds_remaining,
                },
            )

        return ModuleResult(
            self.plugin_id, update.smoothed_risk or 0.0, confidence, STATUS_ACTIVE,
            {
                "raw_risk": update.risk,
                "threshold": update.threshold,
                "gallery_size": update.gallery_size,
                "cos_min": update.cos_min,
                "cos_mean": update.cos_mean,
                "cos_centroid": update.cos_centroid,
                "streak": update.streak,
                "keys_this_window": n_keys,
            },
        )

    # -- fallback path: pure online z-score (no pretrained model available) --
    def _update_legacy(
        self, dwells: list[float], flights: list[float], corrections: int, n_keys: int,
        confidence: float,
    ) -> ModuleResult:
        self.n_keys += len(dwells)
        error_ratio = corrections / max(n_keys, 1)

        if self.n_keys < self.warmup_keys:
            self.dwell_baseline.extend(dwells)
            self.flight_baseline.extend(flights)
            return ModuleResult(
                self.plugin_id, 0.0, 0.0, STATUS_WARMING,
                {"keys_seen": self.n_keys, "need": self.warmup_keys},
            )

        dwell_z = abs(_zscore(fmean(dwells), self.dwell_baseline))
        flight_z = abs(_zscore(fmean(flights), self.flight_baseline)) if flights else 0.0

        risk = min(
            1.0,
            0.45 * min(dwell_z / 3.0, 1.0)
            + 0.45 * min(flight_z / 3.0, 1.0)
            + 0.10 * min(error_ratio * 2.0, 1.0),
        )

        return ModuleResult(
            self.plugin_id, risk, confidence, STATUS_ACTIVE,
            {
                "dwell_zscore": round(dwell_z, 3),
                "flight_zscore": round(flight_z, 3),
                "error_rate_ratio": round(error_ratio, 3),
                "keys_this_window": len(dwells),
            },
        )


def _zscore(value: float, baseline: list[float]) -> float:
    if len(baseline) < 3:
        return 0.0
    std = pstdev(baseline)
    return 0.0 if std < 1e-9 else (value - fmean(baseline)) / std


def _is_number(value) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False
