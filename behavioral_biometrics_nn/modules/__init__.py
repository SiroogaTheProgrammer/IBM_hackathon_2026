"""Pluggable risk modules (late fusion)."""

from .base import ModuleResult, RiskModule
from .composite import CompositeResult, CompositeRiskEngine
from .device import DeviceEnvironmentModule
from .keystroke import KeystrokeModule
from .mouse import MouseBaseModule
from .registry import DEFAULT_CONFIG, REGISTRY, build_engine, load_config
from .tab_navigation import TabNavigationModule

__all__ = [
    "ModuleResult",
    "RiskModule",
    "CompositeResult",
    "CompositeRiskEngine",
    "DeviceEnvironmentModule",
    "KeystrokeModule",
    "MouseBaseModule",
    "TabNavigationModule",
    "DEFAULT_CONFIG",
    "REGISTRY",
    "build_engine",
    "load_config",
]
