/**
 * Offline evaluation harness (description.md §7).
 *
 * §9 puts this before any model work for a reason: tuning against the live
 * demo is not evaluation. Everything here replays cached strokes through the
 * exact production code path — the same extractor, the same scaler, the same
 * encoder, the same §6 backend.
 *
 * **What this measures, and what it does not.** SapiMouse has no task
 * structure, so there is no `subtask_id` to align on. These numbers are
 * therefore the *text-independent* case, which §2 identifies as the weaker of
 * the two settings by a wide margin. The demo flow aligns sub-task to sub-task
 * and should beat this. Treat it as a lower bound and as a regression test on
 * the encoder, never as the headline number for the demo.
 */

import type * as tfTypes from "@tensorflow/tfjs";
import { cosine, poolEmbeddings, type StrokeEncoder } from "../shared/embed.ts";
import { asNorm, logLikelihoodRatio, sprtThresholds, type LlrModel } from "../shared/score.ts";
import { featureRow, type Dataset } from "../node/dataset.ts";

/** One recorded run, reduced to a sequence of pooled block embeddings. */
export type RunEmbedding = {
  subject: number;
  session: number;
  blocks: Float32Array[];
};

export type EvalOptions = {
  /** Fraction of held-out identities used to fit the backend (§5.5, §6.4). */
  calibrationFraction: number;
  /** Target false-lockout rate (§6.3). */
  alpha: number;
  /** Target missed-impostor rate (§6.3). */
  beta: number;
  /** Leak factor for the accumulator (§6.3); 1 disables leaking. */
  leak: number;
  /** Cohort size for AS-norm (§6.2). */
  cohortTopN: number;
};

export const DEFAULT_EVAL: EvalOptions = {
  calibrationFraction: 0.5,
  alpha: 0.02,
  beta: 0.05,
  leak: 0.97,
  cohortTopN: 30,
};

/**
 * SapiMouse has no sub-task ids, so every comparison shares one cohort bucket.
 * In the demo this is a real `task.subtask` key and the cohort is per sub-task,
 * which is where most of AS-norm's value comes from (§6.2).
 */
const GLOBAL_SUBTASK = "*";

/* ----------------------------------------------------------- embedding --- */

/** Encode every real (non-augmented) stroke of the given subjects, by run. */
export async function embedRuns(
  encoder: StrokeEncoder,
  dataset: Dataset,
  subjects: Set<number>,
): Promise<RunEmbedding[]> {
  const byRun = new Map<number, { subject: number; blocks: Map<number, Float32Array[]> }>();

  for (let row = 0; row < dataset.meta.rows; row += 1) {
    if (dataset.augment[row] !== 0) continue;
    const subject = dataset.subject[row]!;
    if (!subjects.has(subject)) continue;

    const session = dataset.session[row]!;
    let run = byRun.get(session);
    if (!run) {
      run = { subject, blocks: new Map() };
      byRun.set(session, run);
    }
    const block = dataset.block[row]!;
    const bucket = run.blocks.get(block);
    if (bucket) bucket.push(featureRow(dataset, row));
    else run.blocks.set(block, [featureRow(dataset, row)]);
  }

  const out: RunEmbedding[] = [];
  for (const [session, run] of byRun) {
    const blockIds = Array.from(run.blocks.keys()).sort((a, b) => a - b);
    const blocks: Float32Array[] = [];
    for (const id of blockIds) {
      const rows = run.blocks.get(id)!;
      // §6.1: a block with fewer than two strokes is skipped, not scored noisily.
      if (rows.length < 2) continue;
      const pooled = poolEmbeddings(await encoder.encode(rows));
      if (pooled) blocks.push(pooled);
    }
    if (blocks.length > 0) out.push({ subject: run.subject, session, blocks });
  }

  return out.sort((a, b) => a.session - b.session);
}

/** Enrollment template for a run: the mean of all its block embeddings. */
function template(run: RunEmbedding): Float32Array | null {
  return poolEmbeddings(run.blocks);
}

/** Split runs into an enrollment run and a test run per subject. */
export type SubjectRuns = { subject: number; enroll: RunEmbedding; test: RunEmbedding };

export function pairRuns(runs: RunEmbedding[]): SubjectRuns[] {
  const bySubject = new Map<number, RunEmbedding[]>();
  for (const run of runs) {
    const list = bySubject.get(run.subject);
    if (list) list.push(run);
    else bySubject.set(run.subject, [run]);
  }

  const out: SubjectRuns[] = [];
  for (const [subject, list] of bySubject) {
    if (list.length < 2) continue;
    // Enrol on the longest run and test on the next longest, mirroring §2.2:
    // enrolment gets the richer session, the test run is the shorter one.
    const sorted = list.slice().sort((a, b) => b.blocks.length - a.blocks.length);
    out.push({ subject, enroll: sorted[0]!, test: sorted[1]! });
  }
  return out.sort((a, b) => a.subject - b.subject);
}

/* --------------------------------------------------------------- scores --- */

export type ScoredComparison = { z: number; genuine: boolean };

/**
 * Score every test block of every subject against every enrollment template —
 * the diagonal gives the genuine distribution, the off-diagonal the impostor
 * distribution (§6.4 items 1 and 2).
 */
export function scoreAllPairs(
  pairs: SubjectRuns[],
  cohort: Float32Array[],
  options: { useAsNorm: boolean; cohortTopN: number },
): ScoredComparison[] {
  const templates = pairs
    .map((pair) => ({ subject: pair.subject, embedding: template(pair.enroll) }))
    .filter((entry): entry is { subject: number; embedding: Float32Array } =>
      entry.embedding !== null,
    );

  const cohortIndex = new Map([[GLOBAL_SUBTASK, cohort]]);
  const out: ScoredComparison[] = [];

  for (const pair of pairs) {
    for (const block of pair.test.blocks) {
      for (const entry of templates) {
        const raw = cosine(entry.embedding, block);
        const z = options.useAsNorm
          ? asNorm(raw, block, cohortIndex, GLOBAL_SUBTASK, options.cohortTopN)
          : raw;
        out.push({ z, genuine: entry.subject === pair.subject });
      }
    }
  }

  return out;
}

/** Equal error rate, by sweeping the threshold over the observed scores. */
export function equalErrorRate(scores: ScoredComparison[]): {
  eer: number;
  threshold: number;
} {
  const genuine = scores.filter((s) => s.genuine).map((s) => s.z).sort((a, b) => a - b);
  const impostor = scores.filter((s) => !s.genuine).map((s) => s.z).sort((a, b) => a - b);
  if (genuine.length === 0 || impostor.length === 0) return { eer: 0.5, threshold: 0 };

  // Reject below the threshold. Sweeping every observed value is exact and, at
  // a few tens of thousands of comparisons, cheap enough not to bother
  // interpolating a DET curve.
  const candidates = Array.from(new Set([...genuine, ...impostor])).sort((a, b) => a - b);

  let best = { eer: 1, threshold: candidates[0]!, gap: Infinity };
  for (const threshold of candidates) {
    const falseReject = lowerCount(genuine, threshold) / genuine.length;
    const falseAccept =
      (impostor.length - lowerCount(impostor, threshold)) / impostor.length;
    const gap = Math.abs(falseReject - falseAccept);
    if (gap < best.gap) {
      best = { eer: (falseReject + falseAccept) / 2, threshold, gap };
    }
  }
  return { eer: best.eer, threshold: best.threshold };
}

/** Number of values strictly below `threshold` in a sorted array. */
function lowerCount(sorted: number[], threshold: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! < threshold) low = mid + 1;
    else high = mid;
  }
  return low;
}

function fitGaussian(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return { mean, std: Math.sqrt(variance) || 1e-6 };
}

/* -------------------------------------------------------- accumulation --- */

export type SessionOutcome = {
  decision: "verified" | "locked" | "inconclusive";
  /** Blocks elapsed when the lower threshold was crossed, if it was. */
  blocksToLockout: number | null;
  trajectory: number[];
};

/**
 * Replay one run through the §6.3 accumulator: per-block LLR, optional leak,
 * Wald SPRT boundaries.
 */
export function accumulate(
  scores: number[],
  model: LlrModel,
  thresholds: { upper: number; lower: number },
  leak: number,
): SessionOutcome {
  let total = 0;
  const trajectory: number[] = [];

  for (let i = 0; i < scores.length; i += 1) {
    total = total * leak + logLikelihoodRatio(scores[i]!, model);
    trajectory.push(total);
    if (total <= thresholds.lower) {
      return { decision: "locked", blocksToLockout: i + 1, trajectory };
    }
    if (total >= thresholds.upper) {
      return { decision: "verified", blocksToLockout: null, trajectory };
    }
  }

  return { decision: "inconclusive", blocksToLockout: null, trajectory };
}

/**
 * Fit the accumulation scale `w` (§6.3).
 *
 * Sub-task scores are correlated — a slow user is slow everywhere — so the raw
 * sum overstates the evidence and the textbook thresholds are optimistic. `w`
 * is chosen as the largest value whose genuine false-lockout rate on the
 * *calibration* runs stays at or under `alpha`. §6.3 is explicit that the
 * unscaled thresholds must not ship.
 */
export function fitAccumulationWeight(
  genuineRuns: number[][],
  base: Omit<LlrModel, "weight">,
  thresholds: { upper: number; lower: number },
  leak: number,
  alpha: number,
): number {
  let best = 0.02;
  for (let w = 1; w >= 0.02; w -= 0.02) {
    const model: LlrModel = { ...base, weight: w };
    const locked = genuineRuns.filter(
      (scores) => accumulate(scores, model, thresholds, leak).decision === "locked",
    ).length;
    if (locked / Math.max(1, genuineRuns.length) <= alpha) {
      best = w;
      break;
    }
  }
  return best;
}

/* ------------------------------------------------------------- reports --- */

export type Report = {
  variant: string;
  comparisons: number;
  eer: number;
  genuine: { mean: number; std: number };
  impostor: { mean: number; std: number };
  dPrime: number;
  weight: number;
  thresholds: { upper: number; lower: number };
  impostorDetectionRate: number;
  falseLockoutRate: number;
  blocksToDetection: { median: number | null; p90: number | null };
  meanTrajectory: { genuine: number[]; impostor: number[] };
};

function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index]!;
}

/** Mean evidence trajectory over block index — the §7 plot, as numbers. */
function meanTrajectory(outcomes: SessionOutcome[], length: number): number[] {
  const sums = new Array<number>(length).fill(0);
  const counts = new Array<number>(length).fill(0);
  for (const outcome of outcomes) {
    outcome.trajectory.forEach((value, index) => {
      if (index >= length) return;
      sums[index]! += value;
      counts[index]! += 1;
    });
    // A run that terminated early keeps contributing its final value, so the
    // mean is not dragged upward by survivorship.
    for (let i = outcome.trajectory.length; i < length; i += 1) {
      sums[i]! += outcome.trajectory[outcome.trajectory.length - 1] ?? 0;
      counts[i]! += 1;
    }
  }
  return sums.map((sum, index) => sum / Math.max(1, counts[index]!));
}

/**
 * Run one full §6 + §7 evaluation: fit the backend on the calibration
 * identities, then measure on the evaluation identities.
 */
export function evaluate(
  variant: string,
  calibration: SubjectRuns[],
  evaluation: SubjectRuns[],
  cohort: Float32Array[],
  options: EvalOptions,
  useAsNorm: boolean,
  accumulateEvidence: boolean,
): Report {
  const scoreOptions = { useAsNorm, cohortTopN: options.cohortTopN };

  /* --- fit on calibration identities ------------------------------------ */

  const calibrationScores = scoreAllPairs(calibration, cohort, scoreOptions);
  const genuineFit = fitGaussian(calibrationScores.filter((s) => s.genuine).map((s) => s.z));
  const impostorFit = fitGaussian(calibrationScores.filter((s) => !s.genuine).map((s) => s.z));

  const thresholds = sprtThresholds(options.alpha, options.beta);
  const leak = accumulateEvidence ? options.leak : 0;

  const calibrationTemplates = new Map(
    calibration
      .map((pair) => [pair.subject, template(pair.enroll)] as const)
      .filter((entry): entry is readonly [number, Float32Array] => entry[1] !== null),
  );
  const cohortIndex = new Map([[GLOBAL_SUBTASK, cohort]]);

  const runScores = (pair: SubjectRuns, against: Float32Array): number[] =>
    pair.test.blocks.map((block) => {
      const raw = cosine(against, block);
      return useAsNorm
        ? asNorm(raw, block, cohortIndex, GLOBAL_SUBTASK, options.cohortTopN)
        : raw;
    });

  const calibrationGenuineRuns = calibration
    .map((pair) => {
      const own = calibrationTemplates.get(pair.subject);
      return own ? runScores(pair, own) : null;
    })
    .filter((scores): scores is number[] => scores !== null);

  const weight = fitAccumulationWeight(
    calibrationGenuineRuns,
    { genuine: genuineFit, impostor: impostorFit },
    thresholds,
    leak,
    options.alpha,
  );
  const model: LlrModel = { genuine: genuineFit, impostor: impostorFit, weight };

  /* --- measure on evaluation identities --------------------------------- */

  const evalTemplates = new Map(
    evaluation
      .map((pair) => [pair.subject, template(pair.enroll)] as const)
      .filter((entry): entry is readonly [number, Float32Array] => entry[1] !== null),
  );

  const genuineOutcomes: SessionOutcome[] = [];
  const impostorOutcomes: SessionOutcome[] = [];

  for (const pair of evaluation) {
    const own = evalTemplates.get(pair.subject);
    if (own) {
      genuineOutcomes.push(accumulate(runScores(pair, own), model, thresholds, leak));
    }
    for (const [subject, other] of evalTemplates) {
      if (subject === pair.subject) continue;
      // The enrolled user is `subject`; `pair` is somebody else at the mouse.
      impostorOutcomes.push(accumulate(runScores(pair, other), model, thresholds, leak));
    }
  }

  const evalScores = scoreAllPairs(evaluation, cohort, scoreOptions);
  const { eer } = equalErrorRate(evalScores);
  const evalGenuine = fitGaussian(evalScores.filter((s) => s.genuine).map((s) => s.z));
  const evalImpostor = fitGaussian(evalScores.filter((s) => !s.genuine).map((s) => s.z));

  const detected = impostorOutcomes.filter((o) => o.decision === "locked");
  const lockoutLengths = detected
    .map((o) => o.blocksToLockout)
    .filter((value): value is number => value !== null);

  const longest = Math.max(
    1,
    ...evaluation.map((pair) => pair.test.blocks.length),
  );

  return {
    variant,
    comparisons: evalScores.length,
    eer,
    genuine: evalGenuine,
    impostor: evalImpostor,
    dPrime:
      Math.abs(evalGenuine.mean - evalImpostor.mean) /
      Math.sqrt((evalGenuine.std ** 2 + evalImpostor.std ** 2) / 2),
    weight,
    thresholds,
    impostorDetectionRate: detected.length / Math.max(1, impostorOutcomes.length),
    falseLockoutRate:
      genuineOutcomes.filter((o) => o.decision === "locked").length /
      Math.max(1, genuineOutcomes.length),
    blocksToDetection: {
      median: percentile(lockoutLengths, 0.5),
      p90: percentile(lockoutLengths, 0.9),
    },
    meanTrajectory: {
      genuine: meanTrajectory(genuineOutcomes, Math.min(longest, 40)),
      impostor: meanTrajectory(impostorOutcomes, Math.min(longest, 40)),
    },
  };
}

/** Build the AS-norm cohort from the calibration identities' templates (§6.2). */
export function buildCohort(calibration: SubjectRuns[]): Float32Array[] {
  const cohort: Float32Array[] = [];
  for (const pair of calibration) {
    // Individual block embeddings, not just the pooled template: AS-norm needs
    // the spread of "typical embeddings at this point in the flow".
    for (const block of pair.enroll.blocks) cohort.push(block);
  }
  return cohort;
}

export type { tfTypes };
