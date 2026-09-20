/**
 * The §6 backend, as it runs in the demo.
 *
 * The primitives — AS-norm, the LLR, the SPRT boundaries — are imported from
 * `big-boy-ts/src/shared/score.ts` rather than reimplemented, so the offline
 * harness and the live demo cannot drift apart. What lives here is only what is
 * specific to running the flow: the leaky accumulator, the three-way verdict,
 * and §3.3's rule about a viewport mismatch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IS AND IS NOT CALIBRATED
 *
 * §6.1 (per-sub-task cosine on encoder embeddings) is real and complete.
 * §6.2 (AS-norm) runs, but against a *global* cohort from the SapiMouse set —
 *      §6.2 wants one bank per sub-task id, and most of its value is in that
 *      split. Needs §6.4.
 * §6.3 (LLR + accumulation + SPRT) runs, with the genuine/impostor
 *      distributions and the accumulation scale `w` fitted on held-out
 *      SapiMouse identities. `big-boy-ts/README.md` is explicit that those
 *      "should not ship" as final; they are here so the pipeline is live end to
 *      end, and `backend.provenance` carries the caveat into the UI.
 * §6.4 (15–20 people running this flow) has not happened. Until it does, the
 *      verdict is a wiring check and a demo, not an evaluated detector.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { asNorm, cosine, logLikelihoodRatio } from "@encoder/index";
import type { CohortIndex } from "@encoder/index";
import { GLOBAL_SUBTASK } from "@/lib/trace/encoder";
import type { BackendConfig } from "@/lib/trace/encoder";
import { viewportsMatch } from "@/lib/trace/capture";
import type { Viewport } from "@/lib/trace/capture";

/** One run's pooled embedding per sub-task id, keyed by `Subtask["id"]`. */
export type RunEmbeddings = Record<string, Float32Array>;

export type Enrollment = {
  capturedAt: number;
  embeddings: RunEmbeddings;
  /** How many of the flow's sub-tasks produced a usable embedding. */
  covered: number;
  /** Geometry the template was captured under (§3.3). */
  viewport: Viewport;
};

/** One scored sub-task of a test run. */
export type SubtaskScore = {
  subtaskId: string;
  /** §6.1 — cosine between the enrolled and the test embedding. */
  raw: number;
  /** §6.2 — the same score after adaptive normalisation. */
  z: number;
  /** §6.3 — calibrated log-likelihood ratio, in nats. */
  llr: number;
  /** Accumulated evidence after this sub-task. */
  evidence: number;
};

export type Verdict = "running" | "verified" | "inconclusive" | "locked";

/**
 * The run shows no trust indicator until this many sub-tasks have scored —
 * §2.2: a live percentage off two comparisons is a high-variance estimator and
 * invites the participant to game it.
 */
export const MIN_SCORED_FOR_INDICATOR = 6;

/** A lockout needs a floor of evidence behind it, not one bad sub-task. */
const MIN_SCORED_FOR_LOCKOUT = 4;

/**
 * How far to widen both SPRT boundaries when the test run's viewport does not
 * match the enrollment's.
 *
 * §3.3 says to treat a geometry mismatch "as a reason to widen the decision
 * thresholds rather than as evidence of an impostor". The factor itself is a
 * judgement call, not a measurement — a resized window moves every target, so
 * every sub-task's score degrades at once, which is exactly the failure mode
 * that would otherwise read as a confident lockout.
 */
const MISMATCH_WIDENING = 1.75;

export type Thresholds = { upper: number; lower: number; widened: boolean };

/**
 * `null` when the backend carries no operating thresholds — §6.3 fits them
 * against a genuine distribution, and §6.4 has not produced one yet.
 */
export function thresholdsFor(
  backend: BackendConfig,
  enrollment: Viewport,
  current: Viewport,
): Thresholds | null {
  if (!backend.thresholds) return null;

  const matched = viewportsMatch(enrollment, current);
  const scale = matched ? 1 : MISMATCH_WIDENING;
  return {
    upper: backend.thresholds.upper * scale,
    lower: backend.thresholds.lower * scale,
    widened: !matched,
  };
}

/* ------------------------------------------------------------- scoring --- */

/**
 * §6.2, with the fallback the shipped cohort forces.
 *
 * `asNorm` returns the raw score untouched when the bank for a sub-task id is
 * missing or too small, so a per-sub-task cohort can be dropped in later
 * without changing this call site — it will simply stop falling through to the
 * global bucket.
 */
function normalize(
  raw: number,
  testEmbedding: Float32Array,
  cohort: CohortIndex,
  subtaskId: string,
  topN: number,
): number {
  const perSubtask = asNorm(raw, testEmbedding, cohort, subtaskId, topN);
  if (perSubtask !== raw) return perSubtask;
  return asNorm(raw, testEmbedding, cohort, GLOBAL_SUBTASK, topN);
}

/** `S ← leak·S + llr` (§6.3), which is also what makes a handover detectable. */
export function accumulate(previous: number, llr: number, leak: number): number {
  return leak * previous + llr;
}

/**
 * Score one sub-task of a test run against the enrollment.
 *
 * Returns `null` when the sub-task has no template or produced no embedding —
 * §6.1 skips those rather than scoring them noisily, and with this flow that is
 * a routine outcome for the short hops: a menu item directly below its trigger
 * simply does not contain two strokes.
 */
export function scoreSubtask(
  subtaskId: string,
  embedding: Float32Array | null,
  enrollment: Enrollment,
  evidenceSoFar: number,
  backend: BackendConfig,
  cohort: CohortIndex,
): SubtaskScore | null {
  const template = enrollment.embeddings[subtaskId];
  if (!embedding || !template) return null;

  const raw = cosine(template, embedding);
  const z = normalize(raw, embedding, cohort, subtaskId, backend.cohort.topN);

  /*
   * §6.1 and §6.2 are fully calibrated on demo runs; §6.3 is not, because the
   * LLR needs a genuine distribution and nobody has recorded the flow twice.
   * The comparison is still real and still recorded — only the likelihood
   * ratio, and therefore the decision, is withheld.
   */
  if (!backend.llr) {
    return { subtaskId, raw, z, llr: 0, evidence: evidenceSoFar };
  }

  const llr = logLikelihoodRatio(z, backend.llr);

  return {
    subtaskId,
    raw,
    z,
    llr,
    evidence: accumulate(evidenceSoFar, llr, backend.accumulator.leak),
  };
}

/**
 * Wald's SPRT, applied after every scored sub-task.
 *
 * The two boundaries are not symmetric in what they *do*, on purpose (§2.2):
 * crossing the lower one locks the run out there and then, while crossing the
 * upper one only latches the verdict — a verified participant finishes the flow
 * normally rather than having it yanked away mid-task. Hence `previous`, which
 * carries a verdict already reached forward.
 */
export function decide(
  scores: SubtaskScore[],
  flowComplete: boolean,
  thresholds: Thresholds,
  previous: Verdict = "running",
): Verdict {
  const last = scores[scores.length - 1];
  if (!last) return flowComplete ? "inconclusive" : "running";

  if (
    last.evidence <= thresholds.lower &&
    scores.length >= MIN_SCORED_FOR_LOCKOUT
  ) {
    return "locked";
  }

  if (previous === "verified" || last.evidence >= thresholds.upper) {
    return "verified";
  }

  return flowComplete ? "inconclusive" : "running";
}

/**
 * Accumulated evidence as a 0–100 "looks like the enrolled user" number, for
 * the end-of-run summary only. It is a monotone squash of `S` between the two
 * SPRT boundaries, not a probability — never present it as one.
 */
export function trustScore(evidence: number, thresholds: Thresholds): number {
  const span = thresholds.upper - thresholds.lower;
  const mid = (thresholds.upper + thresholds.lower) / 2;
  const centred = (evidence - mid) / (span / 6);
  return Math.round(100 / (1 + Math.exp(-centred)));
}
