/**
 * The scoring backend: per-sub-task comparison → calibrated LLR → accumulated
 * evidence → sequential decision. The *shape* here is the one `description.md`
 * §6 specifies, and it is the part that survives if everything else is cut.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PLACEHOLDER. Two pieces of §6 are stubbed, and both are meant to be replaced:
 *
 *   §6.1  `compare()` should be `cos(e_enroll[k], e_test[k])` on 128-d encoder
 *         embeddings. Until the encoder ships it is a scaled L1 distance over
 *         the handcrafted feature vector, which is a far weaker statistic.
 *   §6.2  AS-norm is missing entirely — there is no cohort yet, so a sub-task
 *         that is intrinsically hard for everyone still scores as evidence.
 *   §6.4  `GENUINE` / `IMPOSTOR` / `EVIDENCE_WEIGHT` below are hand-set, not
 *         fitted. The thresholds are therefore the textbook ones §6.3 warns
 *         against shipping unscaled.
 *
 * So: the pipeline runs end to end and the UI is honest about what it is doing,
 * but the numbers it produces are not yet an evaluated detector. Swap
 * `compare()` for the encoder and fit the three constants on the calibration
 * set (§6.4) before any of this is quoted as a result.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { FEATURE_SCALE } from "@/lib/trace/capture";

/** One run's feature vector for one sub-task, keyed by `Subtask["id"]`. */
export type RunVectors = Record<string, number[]>;

export type Enrollment = {
  capturedAt: number;
  vectors: RunVectors;
  /** How many sub-tasks of the flow produced a usable vector. */
  covered: number;
};

/** One scored sub-task of a test run. */
export type SubtaskScore = {
  subtaskId: string;
  /** Scaled distance from the enrollment template. Lower = more like enrollee. */
  distance: number;
  /** Calibrated log-likelihood ratio, in nats. Positive = evidence of genuine. */
  llr: number;
  /** Accumulated evidence after this sub-task. */
  evidence: number;
};

export type Verdict = "running" | "verified" | "inconclusive" | "locked";

/* -------------------------------------------------------- calibration --- */

/**
 * Distributions of `distance` — §6.4 items 1 and 2. NOT fitted: these come from
 * the arithmetic of `compare()` under ideal scales, not from data. If every
 * entry of `FEATURE_SCALE` were the true within-user spread, the per-feature
 * z of a genuine pair would have E[z²] = 2 (a difference of two draws), giving
 * an RMS near √2; a between-user spread of ~2.5× within-user puts the impostor
 * RMS near √(2 + 2.5²) ≈ 2.9. Everything downstream inherits that assumption,
 * which is why §6.4's calibration run replaces both of these first.
 */
const GENUINE = { mean: 1.41, std: 0.40 };
const IMPOSTOR = { mean: 2.90, std: 0.90 };

/**
 * §6.3's `w`. Sub-task scores are correlated (a slow user is slow everywhere),
 * so the raw sum overstates the evidence; this shrinks each contribution.
 */
const EVIDENCE_WEIGHT = 0.5;

/** Leak, so one anomalous sub-task cannot doom a genuine run (§6.3). */
const LEAK = 0.97;

/** α = false lockout rate, β = missed impostor rate. */
const ALPHA = 0.02;
const BETA = 0.05;

export const UPPER_THRESHOLD = Math.log((1 - BETA) / ALPHA);
export const LOWER_THRESHOLD = Math.log(BETA / (1 - ALPHA));

/**
 * The run shows no trust indicator until this many sub-tasks have scored —
 * §2.2: a live percentage off two comparisons is a high-variance estimator and
 * makes the demo look unreliable even when it is right.
 */
export const MIN_SCORED_FOR_INDICATOR = 6;

/** A lockout needs a floor of evidence behind it, not one bad sub-task. */
const MIN_SCORED_FOR_LOCKOUT = 4;

/* ------------------------------------------------------------ scoring --- */

/**
 * Stand-in for §6.1's cosine between encoder embeddings: a diagonal
 * Mahalanobis distance — the RMS of the per-feature z-scores, each feature
 * divided by its expected within-user spread. Roughly "how many
 * typical-person-to-themselves deviations apart are these two runs of the same
 * sub-task".
 *
 * RMS rather than a plain mean on purpose. Only a handful of the ~17 features
 * separate any given pair of people, and averaging absolute deviations buries
 * those few under the dozen that agree — measured on this flow, a deliberately
 * different movement profile landed inside the genuine range under a mean and
 * outside it under an RMS. Squaring keeps the informative features audible.
 * The encoder replaces this outright; §6.2's AS-norm is the principled fix for
 * the same problem.
 */
export function compare(test: number[], enroll: number[]): number | null {
  if (test.length !== enroll.length || test.length === 0) return null;

  let total = 0;
  for (let i = 0; i < test.length; i += 1) {
    const scale = FEATURE_SCALE[i] ?? 1;
    const z = ((test[i] ?? 0) - (enroll[i] ?? 0)) / scale;
    total += z * z;
  }

  return Math.sqrt(total / test.length);
}

function logDensity(value: number, dist: { mean: number; std: number }): number {
  const z = (value - dist.mean) / dist.std;
  return -0.5 * z * z - Math.log(dist.std);
}

/** `log p(d | same user) − log p(d | different user)`, shrunk by `w`. */
export function logLikelihoodRatio(distance: number): number {
  return (
    EVIDENCE_WEIGHT * (logDensity(distance, GENUINE) - logDensity(distance, IMPOSTOR))
  );
}

/** `S ← LEAK·S + llr` (§6.3), which also makes a mid-run handover detectable. */
export function accumulate(previous: number, llr: number): number {
  return LEAK * previous + llr;
}

/**
 * Score one sub-task of a test run against the enrollment. Returns `null` when
 * the sub-task has no template or produced no usable vector — §6.1 skips those.
 */
export function scoreSubtask(
  subtaskId: string,
  vector: number[] | null,
  enrollment: Enrollment,
  evidenceSoFar: number,
): SubtaskScore | null {
  const template = enrollment.vectors[subtaskId];
  if (!vector || !template) return null;

  const distance = compare(vector, template);
  if (distance === null) return null;

  const llr = logLikelihoodRatio(distance);

  return {
    subtaskId,
    distance,
    llr,
    evidence: accumulate(evidenceSoFar, llr),
  };
}

/**
 * Wald's SPRT, applied after every scored sub-task.
 *
 * The two boundaries are not symmetric in what they *do*, on purpose (§2.2):
 * crossing the lower one locks the run out there and then, while crossing the
 * upper one only latches the verdict — a verified participant finishes the
 * flow normally rather than having it yanked away mid-task. Hence `previous`,
 * which carries a verdict already reached forward.
 */
export function decide(
  scores: SubtaskScore[],
  flowComplete: boolean,
  previous: Verdict = "running",
): Verdict {
  const last = scores[scores.length - 1];
  if (!last) return flowComplete ? "inconclusive" : "running";

  if (
    last.evidence <= LOWER_THRESHOLD &&
    scores.length >= MIN_SCORED_FOR_LOCKOUT
  ) {
    return "locked";
  }

  if (previous === "verified" || last.evidence >= UPPER_THRESHOLD) {
    return "verified";
  }

  return flowComplete ? "inconclusive" : "running";
}

/**
 * Accumulated evidence as a 0–100 "looks like the enrolled user" number, for
 * the end-of-run summary only. It is a monotone squash of `S`, not a
 * probability — never present it as one.
 */
export function trustScore(evidence: number): number {
  const span = UPPER_THRESHOLD - LOWER_THRESHOLD;
  const centred = (evidence - (UPPER_THRESHOLD + LOWER_THRESHOLD) / 2) / (span / 6);
  return Math.round(100 / (1 + Math.exp(-centred)));
}
