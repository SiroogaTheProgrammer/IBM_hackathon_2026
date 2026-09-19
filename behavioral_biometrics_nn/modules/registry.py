"""Addon registry: turn a config file into a running CompositeRiskEngine.

Add a new extension in three steps:
  1. subclass ``RiskModule`` in this package
  2. add it to ``REGISTRY`` below
  3. enable it in ``addons.json``

No change to the encoder, the base module or the engine is required.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..encoder import load_base_model
from ..feature_extractor import WINDOW_SECONDS
from ..live import LiveSession
from ..scorer import ESCALATION_CYCLES, GALLERY_SIZE, RISK_THRESHOLD, SMOOTHING_WINDOW
from .base import RiskModule
from .composite import CompositeRiskEngine
from .device import DeviceEnvironmentModule
from .keystroke import KeystrokeModule
from .mouse import MouseBaseModule
from .tab_navigation import TabNavigationModule

REGISTRY: dict[str, type[RiskModule]] = {
    MouseBaseModule.plugin_id: MouseBaseModule,
    TabNavigationModule.plugin_id: TabNavigationModule,
    KeystrokeModule.plugin_id: KeystrokeModule,
    DeviceEnvironmentModule.plugin_id: DeviceEnvironmentModule,
}

DEFAULT_CONFIG = {
    "modules": {
        MouseBaseModule.plugin_id: {"enabled": True, "weight": 1.0},
        TabNavigationModule.plugin_id: {"enabled": True, "weight": 0.6, "hard_trigger": 0.95},
        KeystrokeModule.plugin_id: {"enabled": True, "weight": 0.5},
        DeviceEnvironmentModule.plugin_id: {"enabled": False, "weight": 0.3},
    },
    "session": {
        "warmup_size": GALLERY_SIZE,
        "gallery_mode": "frozen",
        "smoothing": SMOOTHING_WINDOW,
        "threshold": RISK_THRESHOLD,
        "cycles": ESCALATION_CYCLES,
    },
}


def load_config(path=None) -> dict:
    """Read addons.json, falling back to the built-in defaults."""
    config = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    if path is None:
        return config
    file = Path(path)
    if not file.exists():
        return config

    user_config = json.loads(file.read_text(encoding="utf-8"))
    for plugin_id, settings in user_config.get("modules", {}).items():
        if plugin_id not in REGISTRY:
            raise SystemExit(
                f"Unknown module {plugin_id!r} in {file}. "
                f"Known modules: {', '.join(sorted(REGISTRY))}"
            )
        config["modules"].setdefault(plugin_id, {}).update(settings)
    config["session"].update(user_config.get("session", {}))
    return config


def build_engine(
    artifacts_dir,
    config: dict | None = None,
    enable: list[str] | None = None,
    disable: list[str] | None = None,
    seed: int = 0,
) -> CompositeRiskEngine:
    """Instantiate every enabled module and wire it into the engine."""
    config = config or load_config()
    modules_config = config["modules"]
    session_config = config["session"]

    for plugin_id in enable or []:
        _require_known(plugin_id)
        modules_config.setdefault(plugin_id, {})["enabled"] = True
    for plugin_id in disable or []:
        _require_known(plugin_id)
        modules_config.setdefault(plugin_id, {})["enabled"] = False

    encoder, scaler, background, _, _ = load_base_model(artifacts_dir)
    session = LiveSession(
        encoder,
        scaler,
        background,
        warmup_size=int(session_config.get("warmup_size", GALLERY_SIZE)),
        gallery_mode=str(session_config.get("gallery_mode", "frozen")),
        smoothing=int(session_config.get("smoothing", SMOOTHING_WINDOW)),
        cycles=int(session_config.get("cycles", ESCALATION_CYCLES)),
        seed=seed,
        seconds_per_window=WINDOW_SECONDS,
    )

    modules: list[RiskModule] = []
    weights: dict[str, float] = {}
    hard_triggers: dict[str, float] = {}
    for plugin_id, settings in modules_config.items():
        if not settings.get("enabled", False):
            continue
        module_class = REGISTRY[plugin_id]
        modules.append(
            MouseBaseModule(session) if module_class is MouseBaseModule else module_class()
        )
        weights[plugin_id] = float(settings.get("weight", module_class.default_weight))
        if settings.get("hard_trigger") is not None:
            hard_triggers[plugin_id] = float(settings["hard_trigger"])

    if not any(m.is_base for m in modules):
        raise SystemExit("The base module 'mouse_base_v1' cannot be disabled.")

    engine = CompositeRiskEngine(
        modules,
        weights=weights,
        hard_triggers=hard_triggers,
        threshold=float(session_config.get("threshold", RISK_THRESHOLD)),
        cycles=int(session_config.get("cycles", ESCALATION_CYCLES)),
    )
    engine.session = session  # type: ignore[attr-defined]
    return engine


def _require_known(plugin_id: str) -> None:
    if plugin_id not in REGISTRY:
        raise SystemExit(
            f"Unknown module {plugin_id!r}. Known modules: {', '.join(sorted(REGISTRY))}"
        )
