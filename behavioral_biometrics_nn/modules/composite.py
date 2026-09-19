"""Composite risk engine: dynamic weighted late fusion (TEXT 4, section 3).

    Composite = sum(Risk_i * Confidence_i * Weight_i) / sum(Confidence_i * Weight_i)

Modules with confidence 0.0 drop out of both sums, so the authority of the
still-active modules scales up automatically instead of their scores being
diluted by silent modules.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from .base import ModuleResult, RiskModule

DEFAULT_THRESHOLD = 0.80
DEFAULT_CYCLES = 3


@dataclass
class CompositeResult:
    composite_risk: float | None
    verdict: str                   # "ALLOW" | "ESCALATE" | "IDLE"
    streak: int
    escalated: bool
    threshold: float
    hard_triggered: str | None
    active_modules: int
    modules: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class CompositeRiskEngine:
    def __init__(
        self,
        modules: list[RiskModule],
        weights: dict[str, float] | None = None,
        hard_triggers: dict[str, float] | None = None,
        threshold: float = DEFAULT_THRESHOLD,
        cycles: int = DEFAULT_CYCLES,
    ):
        if not modules:
            raise ValueError("at least one module must be enabled")
        self.modules = modules
        self.weights = {m.plugin_id: (weights or {}).get(m.plugin_id, m.default_weight)
                        for m in modules}
        self.hard_triggers = hard_triggers or {}
        self.threshold = threshold
        self.cycles = cycles
        self.streak = 0
        self.escalated = False
        self.history: list[float] = []

    def update(self, telemetry: dict) -> CompositeResult:
        results: list[ModuleResult] = []
        for module in self.modules:
            try:
                results.append(module.update(telemetry))
            except Exception as error:  # a broken plugin must not kill the session
                results.append(
                    ModuleResult(module.plugin_id, 0.0, 0.0, "error", {"error": str(error)})
                )

        numerator = 0.0
        denominator = 0.0
        hard_triggered = None
        for result in results:
            weight = self.weights.get(result.plugin_id, 0.0)
            contribution = result.confidence * weight
            numerator += result.risk_score * contribution
            denominator += contribution

            limit = self.hard_triggers.get(result.plugin_id)
            if limit is not None and result.status == "active" and result.risk_score >= limit:
                hard_triggered = result.plugin_id

        if denominator <= 0.0:
            # Nothing had anything to say this tick: stay silent rather than
            # inventing a score. The streak is preserved, not reset.
            return CompositeResult(
                composite_risk=None, verdict="IDLE", streak=self.streak,
                escalated=self.escalated, threshold=self.threshold,
                hard_triggered=None, active_modules=0,
                modules=[r.to_dict() for r in results],
            )

        composite = numerator / denominator
        self.history.append(composite)
        self.streak = self.streak + 1 if composite >= self.threshold else 0

        if hard_triggered is not None or self.streak >= self.cycles:
            self.escalated = True

        return CompositeResult(
            composite_risk=composite,
            verdict="ESCALATE" if self.escalated else "ALLOW",
            streak=self.streak,
            escalated=self.escalated,
            threshold=self.threshold,
            hard_triggered=hard_triggered,
            active_modules=sum(1 for r in results if r.confidence > 0),
            modules=[r.to_dict() for r in results],
        )

    def describe(self) -> list[dict]:
        return [
            {
                "plugin_id": m.plugin_id,
                "display_name": m.display_name,
                "weight": self.weights[m.plugin_id],
                "is_base": m.is_base,
                "hard_trigger": self.hard_triggers.get(m.plugin_id),
            }
            for m in self.modules
        ]

    def reset(self) -> None:
        for module in self.modules:
            module.reset()
        self.streak = 0
        self.escalated = False
        self.history.clear()
