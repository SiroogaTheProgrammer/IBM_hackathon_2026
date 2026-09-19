"""Plugin interface for risk modules (design_choices.txt TEXT 4).

Late fusion: every module owns its telemetry, runs its own logic and returns a
standardised payload. Adding or removing a module never changes the base
network's 32-feature input shape, so the Siamese encoder is never retrained.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field

STATUS_ACTIVE = "active"
STATUS_INACTIVE = "inactive"
STATUS_WARMING = "warming"


@dataclass
class ModuleResult:
    """The standardised payload every plugin returns each tick."""

    plugin_id: str
    risk_score: float
    confidence: float
    status: str
    detail: dict = field(default_factory=dict)

    def __post_init__(self):
        self.risk_score = float(min(max(self.risk_score, 0.0), 1.0))
        self.confidence = float(min(max(self.confidence, 0.0), 1.0))

    def to_dict(self) -> dict:
        return asdict(self)


class RiskModule(ABC):
    """Base class for the always-on base module and every extension.

    ``confidence`` is how much the module trusts its own score this tick. A
    module with no data to work on must return 0.0 so the composite engine can
    scale up the authority of the modules that do have data.
    """

    plugin_id: str = "unnamed"
    display_name: str = "Unnamed module"
    default_weight: float = 1.0
    is_base: bool = False

    @abstractmethod
    def update(self, telemetry: dict) -> ModuleResult:
        """Process one ~1 s telemetry batch."""

    def reset(self) -> None:
        """Clear per-session state."""

    def inactive(self, reason: str = "no data") -> ModuleResult:
        return ModuleResult(self.plugin_id, 0.0, 0.0, STATUS_INACTIVE, {"reason": reason})
