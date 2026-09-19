/**
 * TypeScript port of `behavioral_biometrics_nn/modules/composite.py`'s
 * `CompositeRiskEngine.update`: dynamic weighted late fusion.
 *
 *     composite = sum(risk_i * confidence_i * weight_i) / sum(confidence_i * weight_i)
 *
 * Modules with confidence 0 drop out of both sums, so the authority of the
 * still-active modules scales up automatically instead of being diluted by
 * silent modules.
 */

export type ModuleTuple = {
  pluginId: string;
  risk: number;
  confidence: number;
  status: string;
};

export type CompositeState = {
  streak: number;
  escalated: boolean;
};

export type CompositeConfig = {
  weights: Record<string, number>;
  hardTriggers: Record<string, number>;
  threshold: number;
  cycles: number;
};

export type CompositeOutcome = {
  compositeRisk: number | null;
  verdict: "ALLOW" | "ESCALATE" | "IDLE";
  streak: number;
  escalated: boolean;
  hardTriggered: string | null;
  activeModules: number;
};

/** Mutates `state` in place; the caller persists it back to the session
 * document afterward. */
export function updateComposite(
  state: CompositeState,
  config: CompositeConfig,
  results: ModuleTuple[],
): CompositeOutcome {
  let numerator = 0;
  let denominator = 0;
  let hardTriggered: string | null = null;

  for (const r of results) {
    const weight = config.weights[r.pluginId] ?? 0;
    const contribution = r.confidence * weight;
    numerator += r.risk * contribution;
    denominator += contribution;

    const limit = config.hardTriggers[r.pluginId];
    if (limit !== undefined && r.status === "active" && r.risk >= limit) hardTriggered = r.pluginId;
  }

  if (denominator <= 0) {
    // Nothing had anything to say this tick: stay silent rather than
    // inventing a score. The streak is preserved, not reset.
    return {
      compositeRisk: null,
      verdict: "IDLE",
      streak: state.streak,
      escalated: state.escalated,
      hardTriggered: null,
      activeModules: 0,
    };
  }

  const composite = numerator / denominator;
  state.streak = composite >= config.threshold ? state.streak + 1 : 0;
  if (hardTriggered !== null || state.streak >= config.cycles) state.escalated = true;

  return {
    compositeRisk: composite,
    verdict: state.escalated ? "ESCALATE" : "ALLOW",
    streak: state.streak,
    escalated: state.escalated,
    hardTriggered,
    activeModules: results.filter((r) => r.confidence > 0).length,
  };
}
