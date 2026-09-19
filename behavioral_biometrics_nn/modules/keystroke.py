"""Extension B: keystroke dynamics (flight / dwell times).

The Balabit training data is mouse-only, so this module cannot be pre-trained
on it. It learns the owner's typing rhythm online during warm-up and scores
later windows as a z-score deviation from that baseline.
"""

from __future__ import annotations

import math
from statistics import fmean, pstdev

from .base import STATUS_ACTIVE, STATUS_WARMING, ModuleResult, RiskModule

WARMUP_KEYS = 40
MIN_KEYS_PER_WINDOW = 4
CORRECTION_KEYS = frozenset({"Backspace", "Delete"})


class KeystrokeModule(RiskModule):
    plugin_id = "keystroke_v1"
    display_name = "Keystroke dynamics"
    default_weight = 0.5

    def __init__(self, warmup_keys: int = WARMUP_KEYS):
        self.warmup_keys = warmup_keys
        self.reset()

    def reset(self) -> None:
        self.dwell_baseline: list[float] = []
        self.flight_baseline: list[float] = []
        self.n_keys = 0

    def update(self, telemetry: dict) -> ModuleResult:
        keys = telemetry.get("keys", [])
        dwells = [float(k["dwell"]) for k in keys if _is_number(k.get("dwell"))]
        flights = [float(k["flight"]) for k in keys if _is_number(k.get("flight"))]

        if len(dwells) < MIN_KEYS_PER_WINDOW:
            return self.inactive(f"only {len(dwells)} keystrokes (need {MIN_KEYS_PER_WINDOW})")

        self.n_keys += len(dwells)
        corrections = sum(1 for k in keys if str(k.get("key", "")) in CORRECTION_KEYS)

        if self.n_keys < self.warmup_keys:
            self.dwell_baseline.extend(dwells)
            self.flight_baseline.extend(flights)
            return ModuleResult(
                self.plugin_id, 0.0, 0.0, STATUS_WARMING,
                {"keys_seen": self.n_keys, "need": self.warmup_keys},
            )

        dwell_z = abs(_zscore(fmean(dwells), self.dwell_baseline))
        flight_z = abs(_zscore(fmean(flights), self.flight_baseline)) if flights else 0.0
        error_ratio = corrections / max(len(keys), 1)

        risk = min(
            1.0,
            0.45 * min(dwell_z / 3.0, 1.0)
            + 0.45 * min(flight_z / 3.0, 1.0)
            + 0.10 * min(error_ratio * 2.0, 1.0),
        )
        confidence = min(1.0, len(dwells) / (2 * MIN_KEYS_PER_WINDOW))

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
