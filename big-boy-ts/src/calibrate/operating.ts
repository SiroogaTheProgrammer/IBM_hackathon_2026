/**
 * Turning a measured impostor distribution into an operating point, when the
 * genuine distribution has not been measured (description.md §6.3, §6.4).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS FILE MAKES ONE ASSUMPTION AND IT IS THE WHOLE STORY
 *
 * The demo collection gives a real per-sub-task cohort and a real impostor
 * distribution, but no genuine one — nobody recorded the flow twice. Without a
 * genuine distribution there is no likelihood ratio and therefore no decision,
 * and the demo sits inert.
 *
 * So exactly one number is borrowed: **d′**, the separation between the two
 * distributions, taken from the offline SapiMouse harness. Everything else —
 * the location and scale the genuine distribution is placed at, the
 * accumulation weight `w`, the error rates — is derived from that plus the
 * demo's own measured impostor distribution.
 *
 * Why this is the least-bad option, and where it can bite:
 *
 *  - It is *conservative by construction*. The harness measured d′ = 1.44 in
 *    the text-independent setting, with no sub-task alignment at all, and §2
 *    calls alignment "the single largest accuracy lever available". The demo
 *    aligns. So the real d′ should be higher than the assumed one, which means
 *    the system under-detects rather than over-locks — errs toward letting an
 *    impostor through, not toward throwing a genuine user out.
 *  - `w` is then fitted the way §6.3 actually specifies: by simulation, as the
 *    largest weight whose false-lockout rate stays under α. That part is not
 *    assumed, it is solved.
 *  - What it cannot capture is within-user drift across sittings, because the
 *    assumed genuine spread is the impostor spread. §6.4 wants runs spaced ≥30
 *    minutes apart precisely so drift is represented; if real drift is wider
 *    than assumed, false lockouts will exceed α.
 *
 * Every number this file produces is marked `assumed: true` in `backend.json`
 * and surfaced in the demo's UI. None of it is a measurement.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { logLikelihoodRatio, sprtThresholds } from "../shared/score.ts";
import type { LlrModel } from "../shared/score.ts";

export type Gaussian = { mean: number; std: number };

export type OperatingOptions = {
  /** Assumed separation between genuine and impostor, in impostor sigmas. */
  dPrime: number;
  alpha: number;
  beta: number;
  leak: number;
  /** Sub-tasks a run is expected to score — sets how much evidence accrues. */
  subtasksPerRun: number;
  /**
   * Measured intraclass correlation of scores within one comparison (§6.3).
   *
   * Simulating independent sub-tasks is the mistake `w` exists to prevent: it
   * makes the evidence look far more informative than it is and drives `w`
   * toward 1. Each simulated session therefore draws a shared level first and
   * per-sub-task noise around it, in the proportion the demo data actually
   * shows.
   */
  correlation: number;
  /** Monte-Carlo sessions per candidate weight. */
  trials: number;
  seed: number;
};

export type OperatingPoint = {
  genuine: Gaussian;
  impostor: Gaussian;
  weight: number;
  thresholds: { upper: number; lower: number };
  /** Simulated, not measured — see the file header. */
  simulated: {
    falseLockoutRate: number;
    impostorDetectionRate: number;
    medianSubtasksToDetection: number | null;
    verifiedRate: number;
  };
};

/** Deterministic PRNG, so a calibration run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, one normal deviate at a time. */
function normal(random: () => number, mean: number, std: number): number {
  const u = Math.max(1e-12, random());
  const v = random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

type SessionOutcome = { locked: boolean; verified: boolean; atSubtask: number | null };

/** Run one simulated session through the §6.3 accumulator and SPRT. */
function simulateSession(
  draw: Gaussian,
  model: LlrModel,
  thresholds: { upper: number; lower: number },
  options: OperatingOptions,
  random: () => number,
): SessionOutcome {
  let evidence = 0;

  // The session's own level, shared by all of its sub-tasks (§6.3).
  const shared = Math.sqrt(options.correlation);
  const independent = Math.sqrt(1 - options.correlation);
  const level = normal(random, 0, 1);

  for (let k = 0; k < options.subtasksPerRun; k += 1) {
    const z =
      draw.mean +
      draw.std * (shared * level + independent * normal(random, 0, 1));
    evidence = options.leak * evidence + logLikelihoodRatio(z, model);

    if (evidence <= thresholds.lower) {
      return { locked: true, verified: false, atSubtask: k + 1 };
    }
    if (evidence >= thresholds.upper) {
      return { locked: false, verified: true, atSubtask: null };
    }
  }

  return { locked: false, verified: false, atSubtask: null };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Solve for `w`.
 *
 * §6.3: "Fit the scalar `w < 1` empirically on the calibration set so that
 * genuine runs cross the lower threshold at the intended rate. Do not ship the
 * textbook thresholds unscaled." Larger `w` accumulates evidence faster in both
 * directions, so false lockout rises with it — the answer is the largest weight
 * that still respects α.
 */
export function fitOperatingPoint(
  impostor: Gaussian,
  options: OperatingOptions,
): OperatingPoint {
  const genuine: Gaussian = {
    mean: impostor.mean + options.dPrime * impostor.std,
    std: impostor.std,
  };
  const thresholds = sprtThresholds(options.alpha, options.beta);

  let best = 0.02;
  let bestReport: OperatingPoint["simulated"] | null = null;

  for (let weight = 0.02; weight <= 1.0001; weight += 0.02) {
    const model: LlrModel = { genuine, impostor, weight };
    const random = mulberry32(options.seed);

    let falseLockouts = 0;
    let verified = 0;
    for (let trial = 0; trial < options.trials; trial += 1) {
      const outcome = simulateSession(genuine, model, thresholds, options, random);
      if (outcome.locked) falseLockouts += 1;
      if (outcome.verified) verified += 1;
    }
    const falseLockoutRate = falseLockouts / options.trials;
    if (falseLockoutRate > options.alpha) break;

    let detected = 0;
    const atSubtask: number[] = [];
    for (let trial = 0; trial < options.trials; trial += 1) {
      const outcome = simulateSession(impostor, model, thresholds, options, random);
      if (outcome.locked) {
        detected += 1;
        if (outcome.atSubtask !== null) atSubtask.push(outcome.atSubtask);
      }
    }

    best = weight;
    bestReport = {
      falseLockoutRate,
      impostorDetectionRate: detected / options.trials,
      medianSubtasksToDetection: median(atSubtask),
      verifiedRate: verified / options.trials,
    };
  }

  return {
    genuine,
    impostor,
    weight: Number(best.toFixed(3)),
    thresholds,
    simulated: bestReport ?? {
      falseLockoutRate: 0,
      impostorDetectionRate: 0,
      medianSubtasksToDetection: null,
      verifiedRate: 0,
    },
  };
}

export const DEFAULT_OPERATING: OperatingOptions = {
  /** The offline harness's measured d′ on held-out SapiMouse identities. */
  dPrime: 1.44,
  alpha: 0.02,
  beta: 0.05,
  leak: 0.97,
  subtasksPerRun: 16,
  correlation: 0,
  trials: 4000,
  seed: 7,
};
