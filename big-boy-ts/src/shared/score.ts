/**
 * Backend scoring primitives (description.md §6).
 *
 * The encoder is only half the system: §6 is where reliability is won. These
 * are the pieces the offline harness needs to report a meaningful number, and
 * the same functions the demo site uses at run time. The *parameters* they take
 * (cohort embeddings, fitted genuine/impostor distributions, the accumulation
 * scale `w`) come from the calibration collection of §6.4, which is a separate
 * data-collection job — nothing here invents them.
 */

import { cosine } from "./embed.ts";

/** Cohort embeddings indexed by sub-task id, as shipped to the client (§6.2). */
export type CohortIndex = Map<string, Float32Array[]>;

/**
 * Adaptive score normalisation (§6.2).
 *
 * Removes the "some sub-tasks are intrinsically hard for everyone" variance by
 * expressing the raw similarity in units of the test embedding's own distance
 * to its nearest cohort members *for that same sub-task id*.
 */
export function asNorm(
  raw: number,
  testEmbedding: Float32Array,
  cohort: CohortIndex,
  subtaskId: string,
  topN = 30,
): number {
  const bank = cohort.get(subtaskId);
  if (!bank || bank.length < 4) return raw;

  const scores = bank.map((entry) => cosine(testEmbedding, entry));
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, Math.min(topN, scores.length));

  const mean = top.reduce((sum, value) => sum + value, 0) / top.length;
  const variance =
    top.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, top.length - 1);
  const sigma = Math.sqrt(variance) || 1e-6;

  return (raw - mean) / sigma;
}

/**
 * Two Gaussians fitted on the calibration set: the normalised score under
 * "same user" and under "different user" (§6.4 items 1 and 2).
 */
export type LlrModel = {
  genuine: { mean: number; std: number };
  impostor: { mean: number; std: number };
  /**
   * Accumulation scale. Sub-task scores are correlated — a slow user is slow
   * everywhere — so the raw sum overstates the evidence. §6.3 is explicit that
   * this must be fitted empirically and that the textbook thresholds must not
   * ship unscaled.
   */
  weight: number;
};

function logNormalPdf(x: number, mean: number, std: number): number {
  const sigma = Math.max(1e-6, std);
  const z = (x - mean) / sigma;
  return -0.5 * z * z - Math.log(sigma) - 0.5 * Math.log(2 * Math.PI);
}

/** Per-sub-task log-likelihood ratio, already scaled by `w` (§6.3). */
export function logLikelihoodRatio(z: number, model: LlrModel): number {
  const same = logNormalPdf(z, model.genuine.mean, model.genuine.std);
  const different = logNormalPdf(z, model.impostor.mean, model.impostor.std);
  return model.weight * (same - different);
}

/**
 * Wald SPRT boundaries for a target false-lockout rate `alpha` and missed
 * impostor rate `beta` (§6.3). Cross `lower` → lock out; cross `upper` →
 * verified; neither by the end of the flow → step-up challenge.
 */
export function sprtThresholds(alpha: number, beta: number): {
  upper: number;
  lower: number;
} {
  return {
    upper: Math.log((1 - beta) / alpha),
    lower: Math.log(beta / (1 - alpha)),
  };
}
