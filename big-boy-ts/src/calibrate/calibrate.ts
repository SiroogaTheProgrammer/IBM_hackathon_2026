/**
 * Calibration from runs recorded on the demo site (description.md §6.4).
 *
 * §6.4 lists five products. What this file can actually produce depends on
 * whether any participant recorded the flow more than once, and with the
 * collection as it stands — twelve people, one run each — the answer splits
 * cleanly in half:
 *
 *   1. Genuine score distribution   NO. Needs run 2 vs run 3 of the same
 *                                   person. One run each means zero same-person
 *                                   pairs; there is nothing to fit.
 *   2. Impostor score distribution  YES. Every ordered pair of distinct
 *                                   subjects, per sub-task id.
 *   3. Cohort embeddings, per       YES, and this is the one that matters most.
 *      sub-task id                  §6.2 puts most of AS-norm's value in the
 *                                   per-sub-task split, and only demo runs have
 *                                   sub-task ids at all.
 *   4. Accumulation scale `w`       NO. §6.3 fits it so that *genuine* runs
 *      and operating thresholds     cross the lower boundary at the intended
 *                                   rate. No genuine runs, no fit.
 *   5. Per-sub-task informativeness NOT as d′ — that needs both distributions.
 *                                   What is measurable is the other half of
 *                                   d′: a sub-task whose twelve embeddings are
 *                                   nearly identical across people cannot
 *                                   separate anyone no matter how stable it is
 *                                   within a person. That is reported instead,
 *                                   as `betweenSubjectSpread`.
 *
 * Nothing here invents the missing halves. The genuine distribution stays where
 * it was, marked with its provenance, and the report says what one repeat run
 * per participant would unlock.
 */

import { cosine, poolEmbeddings } from "../shared/embed.ts";
import type { StrokeEncoder } from "../shared/embed.ts";
import { extractFromEvents } from "../shared/pipeline.ts";
import { asNorm } from "../shared/score.ts";
import type { CohortIndex } from "../shared/score.ts";
import type { DemoRun } from "../node/demoRuns.ts";

/* ------------------------------------------------------------------ QC --- */

export type QcOptions = {
  /**
   * How far past the median a sub-task may run before it is treated as the
   * participant having lost the thread rather than performed the task.
   *
   * The collection was explicitly not cleaned: people hunted for targets, and
   * it shows as duration blowouts — 86 s on a sub-task whose median is 3.5 s.
   * Those samples are not a slow motor signature, they are somebody reading the
   * screen, and §2.3 is the reason to care: think time is exactly the channel
   * that carries familiarity rather than identity.
   */
  durationMultiple: number;
  /** Absolute floor, so a fast sub-task with a tiny median is not over-pruned. */
  minDurationSeconds: number;
};

export const DEFAULT_QC: QcOptions = {
  durationMultiple: 4,
  minDurationSeconds: 12,
};

export type DroppedReason = "lost" | "too-few-strokes";

export type SubtaskSample = {
  subject: string;
  run: string;
  subtaskId: string;
  seconds: number;
  strokes: number;
  embedding: Float32Array;
};

export type CalibrationData = {
  samples: SubtaskSample[];
  subjects: string[];
  subtaskIds: string[];
  dropped: { subtaskId: string; run: string; reason: DroppedReason; seconds: number }[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function durationOf(events: { t: number }[]): number {
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return 0;
  return (last.t - first.t) / 1000;
}

/**
 * Segment, extract and embed every sub-task of every run, dropping the ones QC
 * rejects. One embedding per (run, sub-task id) — §5.1's pooled average.
 */
export async function embedRuns(
  encoder: StrokeEncoder,
  runs: DemoRun[],
  qc: QcOptions = DEFAULT_QC,
): Promise<CalibrationData> {
  // Per-sub-task duration medians, needed before anything can be called an
  // outlier, so this is a two-pass job.
  const durations = new Map<string, number[]>();
  for (const run of runs) {
    for (const [subtaskId, events] of run.subtasks) {
      const bucket = durations.get(subtaskId);
      if (bucket) bucket.push(durationOf(events));
      else durations.set(subtaskId, [durationOf(events)]);
    }
  }
  const limits = new Map<string, number>();
  for (const [subtaskId, values] of durations) {
    limits.set(
      subtaskId,
      Math.max(qc.minDurationSeconds, median(values) * qc.durationMultiple),
    );
  }

  const samples: SubtaskSample[] = [];
  const dropped: CalibrationData["dropped"] = [];

  for (const run of runs) {
    for (const [subtaskId, events] of run.subtasks) {
      const seconds = durationOf(events);

      if (seconds > (limits.get(subtaskId) ?? Infinity)) {
        dropped.push({ subtaskId, run: run.run, reason: "lost", seconds });
        continue;
      }

      const strokes = extractFromEvents(events, {
        diagonal: run.viewport.diagonal,
      });

      // §6.1: fewer than two strokes is skipped rather than scored noisily.
      if (strokes.length < 2) {
        dropped.push({
          subtaskId,
          run: run.run,
          reason: "too-few-strokes",
          seconds,
        });
        continue;
      }

      const embedding = poolEmbeddings(
        await encoder.encode(strokes.map((entry) => entry.features)),
      );
      if (!embedding) continue;

      samples.push({
        subject: run.subject,
        run: run.run,
        subtaskId,
        seconds,
        strokes: strokes.length,
        embedding,
      });
    }
  }

  return {
    samples,
    subjects: [...new Set(runs.map((run) => run.subject))].sort(),
    subtaskIds: [...new Set(samples.map((sample) => sample.subtaskId))].sort(),
    dropped,
  };
}

/* -------------------------------------------------------------- cohort --- */

/**
 * §6.4 item 3 — cohort embeddings indexed by sub-task id.
 *
 * This is the piece the public datasets structurally cannot give: SapiMouse has
 * no tasks, so its cohort is one undifferentiated bank and AS-norm can only ask
 * "is this embedding unusual in general". With a per-sub-task bank it asks "is
 * this embedding unusual *for this step of this flow*", which is §6.2's actual
 * claim and where its payoff lives.
 */
export function buildCohort(data: CalibrationData): CohortIndex {
  const cohort: CohortIndex = new Map();
  for (const sample of data.samples) {
    const bank = cohort.get(sample.subtaskId);
    if (bank) bank.push(sample.embedding);
    else cohort.set(sample.subtaskId, [sample.embedding]);
  }
  return cohort;
}

/**
 * The cohort with one subject removed.
 *
 * Scoring a comparison against a cohort that contains the very embeddings being
 * compared is leakage: the test embedding is its own nearest neighbour, which
 * drags μ_topN up and collapses σ_topN. Every score below is computed with both
 * sides of the pair held out.
 */
function cohortWithout(
  cohort: CohortIndex,
  excluded: Set<Float32Array>,
): CohortIndex {
  const out: CohortIndex = new Map();
  for (const [subtaskId, bank] of cohort) {
    out.set(
      subtaskId,
      bank.filter((embedding) => !excluded.has(embedding)),
    );
  }
  return out;
}

/* -------------------------------------------------------------- scores --- */

export type ScoreSet = {
  /** Normalised scores, pooled over every sub-task. */
  z: number[];
  /** The same, split by sub-task id. */
  bySubtask: Map<string, number[]>;
  /**
   * The same again, split by *comparison* — one entry per (enroll run, test
   * run) pair, holding that pair's score on every sub-task they share.
   *
   * This grouping is what makes §6.3's correlation measurable. "A slow user is
   * slow everywhere" means the scores within one comparison move together, so
   * the sum overstates the independent evidence; grouping by pair is how much
   * they move together can be read off the data instead of guessed.
   */
  byPair: Map<string, number[]>;
};

export type Gaussian = { mean: number; std: number };

export function fitGaussian(values: number[]): Gaussian {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  return { mean, std: Math.sqrt(variance) || 1e-6 };
}

/**
 * Score every pair of runs, per sub-task, through the real §6.1 → §6.2 path.
 *
 * `genuine` pairs are two runs of one subject and `impostor` pairs are two
 * subjects. With one run per participant the genuine set comes back empty,
 * which is the honest output rather than an error.
 */
export function scorePairs(
  data: CalibrationData,
  cohort: CohortIndex,
  topN: number,
): { genuine: ScoreSet; impostor: ScoreSet } {
  const bySubtask = new Map<string, SubtaskSample[]>();
  for (const sample of data.samples) {
    const bucket = bySubtask.get(sample.subtaskId);
    if (bucket) bucket.push(sample);
    else bySubtask.set(sample.subtaskId, [sample]);
  }

  const genuine: ScoreSet = { z: [], bySubtask: new Map(), byPair: new Map() };
  const impostor: ScoreSet = { z: [], bySubtask: new Map(), byPair: new Map() };

  const record = (
    set: ScoreSet,
    subtaskId: string,
    pair: string,
    z: number,
  ): void => {
    set.z.push(z);
    const bucket = set.bySubtask.get(subtaskId);
    if (bucket) bucket.push(z);
    else set.bySubtask.set(subtaskId, [z]);

    const group = set.byPair.get(pair);
    if (group) group.push(z);
    else set.byPair.set(pair, [z]);
  };

  for (const [subtaskId, samples] of bySubtask) {
    for (const enroll of samples) {
      for (const test of samples) {
        if (enroll.run === test.run) continue;

        const held = cohortWithout(
          cohort,
          new Set([enroll.embedding, test.embedding]),
        );
        const raw = cosine(enroll.embedding, test.embedding);
        const z = asNorm(raw, test.embedding, held, subtaskId, topN);

        record(
          enroll.subject === test.subject ? genuine : impostor,
          subtaskId,
          `${enroll.run}->${test.run}`,
          z,
        );
      }
    }
  }

  return { genuine, impostor };
}

/**
 * How much of a comparison's score is a property of the pair rather than of the
 * sub-task — the intraclass correlation.
 *
 * §6.3's honesty caveat in one number. If every sub-task of a comparison scores
 * independently, ρ = 0 and summing LLRs is sound. If a comparison has a level
 * of its own that all its sub-tasks share, ρ > 0 and the sum counts the same
 * evidence repeatedly, which is why `w` must be less than one. Measuring ρ is
 * what stops `w` being a guess.
 */
export function intraclassCorrelation(groups: Map<string, number[]>): number {
  const usable = [...groups.values()].filter((group) => group.length >= 2);
  if (usable.length < 2) return 0;

  const all = usable.flat();
  const grand = all.reduce((sum, value) => sum + value, 0) / all.length;

  let between = 0;
  let within = 0;
  let weights = 0;

  for (const group of usable) {
    const mean = group.reduce((sum, value) => sum + value, 0) / group.length;
    between += group.length * (mean - grand) ** 2;
    for (const value of group) within += (value - mean) ** 2;
    weights += group.length;
  }

  const dfBetween = Math.max(1, usable.length - 1);
  const dfWithin = Math.max(1, weights - usable.length);
  const msBetween = between / dfBetween;
  const msWithin = within / dfWithin;
  const groupSize = weights / usable.length;

  const rho =
    (msBetween - msWithin) / (msBetween + (groupSize - 1) * msWithin);
  return Math.min(0.95, Math.max(0, Number.isFinite(rho) ? rho : 0));
}

/* --------------------------------------------------------- diagnostics --- */

export type SubtaskReport = {
  subtaskId: string;
  /** Runs that produced a usable embedding. */
  kept: number;
  droppedLost: number;
  droppedShort: number;
  medianSeconds: number;
  medianStrokes: number;
  /**
   * Mean pairwise cosine between *different* people on this sub-task.
   *
   * §6.4 item 5 asks which sub-tasks discriminate. d′ needs a genuine
   * distribution, but half of the question is answerable without one: if every
   * participant's embedding for a sub-task is nearly identical (this number
   * close to 1), the sub-task cannot separate anybody however stable it is
   * within a person. Those are the "short travel distance or no free cursor
   * movement" steps §6.4 predicts, and the ones to redesign.
   */
  betweenSubjectSimilarity: number;
  /** Spread of that similarity — a wide one means the step is at least alive. */
  betweenSubjectSpread: number;
};

export function describeSubtasks(
  data: CalibrationData,
  flowOrder: string[],
): SubtaskReport[] {
  const bySubtask = new Map<string, SubtaskSample[]>();
  for (const sample of data.samples) {
    const bucket = bySubtask.get(sample.subtaskId);
    if (bucket) bucket.push(sample);
    else bySubtask.set(sample.subtaskId, [sample]);
  }

  const ids = flowOrder.length > 0 ? flowOrder : [...bySubtask.keys()].sort();

  return ids.map((subtaskId) => {
    const samples = bySubtask.get(subtaskId) ?? [];
    const raws: number[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      for (let j = i + 1; j < samples.length; j += 1) {
        const a = samples[i]!;
        const b = samples[j]!;
        if (a.subject === b.subject) continue;
        raws.push(cosine(a.embedding, b.embedding));
      }
    }
    const fitted = fitGaussian(raws);

    const drops = data.dropped.filter((entry) => entry.subtaskId === subtaskId);

    return {
      subtaskId,
      kept: samples.length,
      droppedLost: drops.filter((entry) => entry.reason === "lost").length,
      droppedShort: drops.filter((entry) => entry.reason === "too-few-strokes")
        .length,
      medianSeconds: median(samples.map((sample) => sample.seconds)),
      medianStrokes: median(samples.map((sample) => sample.strokes)),
      betweenSubjectSimilarity: raws.length > 0 ? fitted.mean : Number.NaN,
      betweenSubjectSpread: raws.length > 1 ? fitted.std : Number.NaN,
    };
  });
}
