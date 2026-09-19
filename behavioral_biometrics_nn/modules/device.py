"""Extension C: device / environment signals.

Window resizes, focus loss (blur/focus) and screen-resolution changes. Cheap to
compute and useful as a corroborating signal rather than a primary one.
"""

from __future__ import annotations

from .base import STATUS_ACTIVE, ModuleResult, RiskModule

BLUR_SATURATION = 3       # blur events in one window that saturate the signal
RESIZE_SATURATION = 2


class DeviceEnvironmentModule(RiskModule):
    plugin_id = "device_env_v1"
    display_name = "Device / environment"
    default_weight = 0.3

    def __init__(self):
        self.reset()

    def reset(self) -> None:
        self.screen: str | None = None

    def update(self, telemetry: dict) -> ModuleResult:
        device = telemetry.get("device")
        if not device:
            return self.inactive("no device events in this window")

        blurs = int(device.get("blur_count", 0))
        resizes = int(device.get("resize_count", 0))
        screen = str(device.get("screen", "")) or None

        screen_changed = bool(self.screen and screen and screen != self.screen)
        if screen:
            self.screen = screen

        risk = min(
            1.0,
            0.40 * min(blurs / BLUR_SATURATION, 1.0)
            + 0.30 * min(resizes / RESIZE_SATURATION, 1.0)
            + 0.30 * float(screen_changed),
        )

        return ModuleResult(
            self.plugin_id, risk, 0.8, STATUS_ACTIVE,
            {
                "blur_count": blurs,
                "resize_count": resizes,
                "screen": screen or "unknown",
                "screen_changed": screen_changed,
            },
        )
