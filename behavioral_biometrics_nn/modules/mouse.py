"""Base module: mouse/pointer physical dynamics (always active).

Wraps the frozen Siamese encoder + live gallery + LightGBM scorer. This is the
only module that uses the neural network; extensions are pure statistics.
"""

from __future__ import annotations

import numpy as np

from ..feature_extractor import (
    MIN_MOVE_EVENTS,
    MOVEMENT_STATES,
    Event,
    extract_window_features,
)
from ..live import LiveSession
from .base import STATUS_ACTIVE, STATUS_WARMING, ModuleResult, RiskModule


class MouseBaseModule(RiskModule):
    plugin_id = "mouse_base_v1"
    display_name = "Mouse / pointer dynamics (base)"
    default_weight = 1.0
    is_base = True

    def __init__(self, session: LiveSession):
        self.session = session

    def update(self, telemetry: dict) -> ModuleResult:
        events = _to_events(telemetry.get("events", []))
        moves = sum(1 for e in events if e.state in MOVEMENT_STATES)
        if moves < MIN_MOVE_EVENTS:
            # Mouse idle: the design requires confidence 0.0 so the composite
            # engine hands authority to the other modules instead of guessing.
            return self.inactive(f"only {moves} movement samples (need {MIN_MOVE_EVENTS})")

        features = extract_window_features(events)
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
            self.plugin_id, update.smoothed_risk or 0.0, 1.0, STATUS_ACTIVE,
            {
                "raw_risk": update.risk,
                "threshold": update.threshold,
                "gallery_size": update.gallery_size,
                "cos_min": update.cos_min,
                "cos_mean": update.cos_mean,
                "cos_centroid": update.cos_centroid,
                "streak": update.streak,
            },
        )

    def reset(self) -> None:
        self.session.reset()


def _to_events(raw: list[dict]) -> list[Event]:
    """Convert browser telemetry JSON into extractor events."""
    events: list[Event] = []
    for item in raw:
        try:
            events.append(
                Event(
                    t=float(item["t"]),
                    button=str(item.get("button", "NoButton")),
                    state=str(item.get("state", "Move")),
                    x=float(item["x"]),
                    y=float(item["y"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    events.sort(key=lambda e: e.t)
    return events
