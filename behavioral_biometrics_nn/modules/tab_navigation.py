"""Extension A: tab navigation (design_choices.txt FILE 3).

Markov transition surprise + dwell-time z-score + rolling sequence entropy.
Pure statistics, learned online during the same warm-up period as the base
module, so nothing has to be pre-trained.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque

from .base import STATUS_ACTIVE, STATUS_WARMING, ModuleResult, RiskModule

ENTROPY_WINDOW = 5
WARMUP_TRANSITIONS = 8
LAPLACE_ALPHA = 1.0
SURPRISE_CAP_BITS = 6.0       # -log2(p) at p ~= 0.015
OUT_OF_ORDER_PROB = 0.05


class TabNavigationModule(RiskModule):
    plugin_id = "tab_navigation_v1"
    display_name = "Tab navigation path"
    default_weight = 0.6

    def __init__(self, entropy_window: int = ENTROPY_WINDOW,
                 warmup_transitions: int = WARMUP_TRANSITIONS):
        self.entropy_window = entropy_window
        self.warmup_transitions = warmup_transitions
        self.reset()

    def reset(self) -> None:
        self.transitions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.dwell: dict[str, list[float]] = defaultdict(list)
        self.recent: deque[str] = deque(maxlen=self.entropy_window)
        self.n_transitions = 0
        self.prev_tab: str | None = None

    def update(self, telemetry: dict) -> ModuleResult:
        visits = telemetry.get("nav", [])
        if not visits:
            return self.inactive("no tab changes in this window")

        surprises: list[float] = []
        zscores: list[float] = []
        out_of_order = 0

        for visit in visits:
            tab = str(visit.get("tab", ""))
            dwell = float(visit.get("dwell", 0.0))
            if not tab:
                continue

            if self.prev_tab is not None:
                probability = self._transition_probability(self.prev_tab, tab)
                surprises.append(min(-math.log2(probability), SURPRISE_CAP_BITS))
                if probability < OUT_OF_ORDER_PROB:
                    out_of_order += 1
                self.transitions[self.prev_tab][tab] += 1
                self.n_transitions += 1

            if dwell > 0 and self.prev_tab is not None:
                zscores.append(abs(self._dwell_zscore(self.prev_tab, dwell)))
                self.dwell[self.prev_tab].append(dwell)

            self.recent.append(tab)
            self.prev_tab = tab

        if self.n_transitions < self.warmup_transitions:
            return ModuleResult(
                self.plugin_id, 0.0, 0.0, STATUS_WARMING,
                {"transitions_seen": self.n_transitions, "need": self.warmup_transitions},
            )

        surprise = max(surprises) if surprises else 0.0
        zscore = max(zscores) if zscores else 0.0
        entropy = self._sequence_entropy()

        # Each term is mapped to 0-1, then combined. Surprise dominates because
        # an unseen transition is the strongest single signal.
        risk = min(
            1.0,
            0.60 * (surprise / SURPRISE_CAP_BITS)
            + 0.25 * min(zscore / 3.0, 1.0)
            + 0.15 * min(entropy / math.log2(max(len(self.recent), 2)), 1.0),
        )
        confidence = min(1.0, self.n_transitions / (2 * self.warmup_transitions))

        return ModuleResult(
            self.plugin_id, risk, confidence, STATUS_ACTIVE,
            {
                "transition_surprise_bits": round(surprise, 3),
                "dwell_zscore": round(zscore, 3),
                "sequence_entropy": round(entropy, 3),
                "out_of_order_flag": int(out_of_order > 0),
                "path": list(self.recent),
            },
        )

    def _transition_probability(self, source: str, target: str) -> float:
        row = self.transitions[source]
        n_targets = max(len(self.transitions) + 1, 2)
        total = sum(row.values()) + LAPLACE_ALPHA * n_targets
        return (row.get(target, 0) + LAPLACE_ALPHA) / total

    def _dwell_zscore(self, tab: str, dwell: float) -> float:
        history = self.dwell.get(tab, [])
        if len(history) < 3:
            return 0.0
        mean = sum(history) / len(history)
        variance = sum((d - mean) ** 2 for d in history) / len(history)
        std = math.sqrt(variance)
        return 0.0 if std < 1e-6 else (dwell - mean) / std

    def _sequence_entropy(self) -> float:
        if not self.recent:
            return 0.0
        counts: dict[str, int] = defaultdict(int)
        for tab in self.recent:
            counts[tab] += 1
        total = len(self.recent)
        return -sum((c / total) * math.log2(c / total) for c in counts.values())
