/**
 * Per-stroke feature extraction (description.md §4).
 *
 * Scope note, and it is the important one: this file computes only the
 * **trajectory-intrinsic** block — everything derivable from (t, x, y, button)
 * alone. The target-relative features of §4 (Fitts residual against a known
 * target width, endpoint offset inside a bounding box, approach angle relative
 * to the widget) cannot be computed on a public dataset, because the public
 * dataset has no DOM.
 *
 * They are deliberately *not* padded with zeros here. A constant column at
 * training time that becomes a live value at test time is worse than no column:
 * the encoder learns to ignore it, and then the distribution shifts under it.
 * Target-relative signal enters the system one layer up, in the backend of §6,
 * where it is scored against the enrolled template for the same `subtask_id`.
 * See `README.md` for the split.
 *
 * Feature order is a wire contract between the trained scaler, the trained
 * encoder and the browser. Append, never reorder, and bump `FEATURE_VERSION`.
 */

import { FRAME_S, resample60Hz } from "./resample.ts";
import type { Stroke, StrokeContext } from "./types.ts";

export const FEATURE_VERSION = "stroke-core-v1";

export const FEATURE_NAMES = [
  /* --- extent and timing ------------------------------------------------ */
  "log_duration", //               log1p seconds
  "path_length", //                viewport diagonals travelled
  "net_distance", //               viewport diagonals start→end
  "straightness", //               net / path, 0..1
  "log_gap_before", //             log1p seconds idle before the stroke

  /* --- speed ------------------------------------------------------------ */
  "speed_mean", //                 diagonals / s
  "speed_std",
  "speed_max",
  "speed_median",
  "speed_cv", //                   std / mean — scale-free, survives DPI change
  "speed_efficiency", //           mean / max — how peaked the profile is
  "time_to_peak_frac", //          when peak velocity happens, 0..1 of duration
  "frac_above_half_peak", //       how long the fast phase lasts

  /* --- acceleration ----------------------------------------------------- */
  "accel_abs_mean", //             diagonals / s²
  "accel_std",
  "accel_max", //                  peak acceleration
  "accel_min", //                  peak deceleration (negative)
  "accel_pos_frac", //             fraction of the stroke spent speeding up

  /* --- jerk ------------------------------------------------------------- */
  "jerk_abs_mean", //              diagonals / s³
  "jerk_std",
  "jerk_sign_change_rate", //      per second — tremor / micro-correction rate

  /* --- path shape ------------------------------------------------------- */
  "curvature_mean", //             |dθ| per unit path length
  "curvature_std",
  "curvature_max",
  "total_abs_angle", //            total turning, radians
  "log_reversal_rate", //          direction reversals per second, log1p
  "max_deviation_ratio", //        max perpendicular bow / net distance

  /* --- pauses and submovements ------------------------------------------ */
  "log_pause_count",
  "pause_time_frac",
  "log_submovement_count", //      velocity peaks — ballistic + corrective phases
  "terminal_speed_ratio", //       braking: last 15% mean speed / overall mean
  "log_terminal_correction_rate", // reversals in the final quarter, per second

  /* --- segmentation context --------------------------------------------- */
  "is_click_terminated",
  "is_drag",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_COUNT = FEATURE_NAMES.length;

/** Speed (diagonals / s) below which a frame counts as a pause. */
const PAUSE_SPEED = 0.05;

/** A heading change beyond this counts as a direction reversal. */
const REVERSAL_ANGLE = Math.PI / 2;

/** A velocity peak must clear this fraction of the stroke's max to count. */
const SUBMOVEMENT_PROMINENCE = 0.15;

/** Fewer resampled frames than this and the derivatives are meaningless. */
const MIN_FRAMES = 6;

/* ------------------------------------------------------------- helpers --- */

function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i]!;
  return sum / values.length;
}

function std(values: ArrayLike<number>, average: number): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += (values[i]! - average) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

function median(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/** First differences with respect to a fixed step, in per-second units. */
function derivative(values: number[], dt: number): number[] {
  const out: number[] = new Array(Math.max(0, values.length - 1));
  for (let i = 1; i < values.length; i += 1) {
    out[i - 1] = (values[i]! - values[i - 1]!) / dt;
  }
  return out;
}

function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Guards every ratio: a feature is never allowed to be NaN or Infinity. */
function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return fallback;
  if (Math.abs(denominator) < 1e-9) return fallback;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Count local maxima in the speed profile that rise at least
 * `SUBMOVEMENT_PROMINENCE · max` above the valley preceding them. This is a
 * cheap stand-in for a proper submovement decomposition and is stable enough at
 * 60 Hz; it captures "one smooth throw" versus "throw, overshoot, two nudges".
 */
function countSubmovements(speeds: number[]): number {
  if (speeds.length < 3) return 0;
  let maxSpeed = 0;
  for (const speed of speeds) if (speed > maxSpeed) maxSpeed = speed;
  if (maxSpeed <= 0) return 0;

  const threshold = maxSpeed * SUBMOVEMENT_PROMINENCE;
  let peaks = 0;
  let valley = speeds[0]!;
  let rising = false;

  for (let i = 1; i < speeds.length; i += 1) {
    const speed = speeds[i]!;
    const previous = speeds[i - 1]!;
    if (speed > previous) {
      if (!rising) valley = previous;
      rising = true;
    } else if (speed < previous && rising) {
      if (previous - valley >= threshold) peaks += 1;
      rising = false;
    }
  }
  if (rising && speeds[speeds.length - 1]! - valley >= threshold) peaks += 1;

  return peaks;
}

/* ------------------------------------------------------------ extractor --- */

/**
 * Reduce one stroke to its fixed-length feature vector, or `null` when the
 * stroke is too short to describe. §6.1 skips those rather than scoring them
 * noisily — a two-sample "stroke" would otherwise contribute pure variance.
 */
export function extractStrokeFeatures(
  stroke: Stroke,
  context: StrokeContext,
): Float32Array | null {
  if (stroke.samples.length < MIN_FRAMES) return null;

  const samples = resample60Hz(stroke.samples);
  if (samples.length < MIN_FRAMES) return null;

  const diagonal = context.diagonal > 0 ? context.diagonal : 1;
  const dt = FRAME_S;

  /* --- geometry --------------------------------------------------------- */

  const steps: number[] = new Array(samples.length - 1);
  const headings: number[] = [];
  const headingIndex: number[] = [];

  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    steps[i - 1] = Math.hypot(dx, dy) / diagonal;
    if (dx !== 0 || dy !== 0) {
      headings.push(Math.atan2(dy, dx));
      headingIndex.push(i - 1);
    }
  }

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;

  let pathLength = 0;
  for (const step of steps) pathLength += step;

  const netDistance = Math.hypot(last.x - first.x, last.y - first.y) / diagonal;
  const straightness = safeDiv(netDistance, pathLength);

  // Maximum perpendicular departure from the straight line start→end, as a
  // fraction of that line. Distinguishes a bowed sweep from a straight drive
  // even when both have the same straightness ratio.
  let maxDeviation = 0;
  const netX = last.x - first.x;
  const netY = last.y - first.y;
  const netLength = Math.hypot(netX, netY);
  if (netLength > 1e-6) {
    for (const sample of samples) {
      const cross =
        Math.abs((sample.x - first.x) * netY - (sample.y - first.y) * netX) /
        netLength;
      if (cross > maxDeviation) maxDeviation = cross;
    }
  }

  /* --- kinematics ------------------------------------------------------- */

  const speeds = steps.map((step) => step / dt);
  const accelerations = derivative(speeds, dt);
  const jerks = derivative(accelerations, dt);

  const speedMean = mean(speeds);
  const speedStd = std(speeds, speedMean);
  let speedMax = 0;
  let peakIndex = 0;
  for (let i = 0; i < speeds.length; i += 1) {
    if (speeds[i]! > speedMax) {
      speedMax = speeds[i]!;
      peakIndex = i;
    }
  }

  const timeToPeak = speeds.length > 1 ? peakIndex / (speeds.length - 1) : 0;
  const halfPeak = speedMax * 0.5;
  const aboveHalf = speeds.reduce(
    (count, speed) => count + (speed >= halfPeak ? 1 : 0),
    0,
  );

  const accelAbs = accelerations.map(Math.abs);
  const accelMean = mean(accelerations);
  let accelMax = 0;
  let accelMin = 0;
  let accelPositive = 0;
  for (const value of accelerations) {
    if (value > accelMax) accelMax = value;
    if (value < accelMin) accelMin = value;
    if (value > 0) accelPositive += 1;
  }

  const jerkMean = mean(jerks);
  let jerkSignChanges = 0;
  for (let i = 1; i < jerks.length; i += 1) {
    if (Math.sign(jerks[i]!) !== Math.sign(jerks[i - 1]!)) jerkSignChanges += 1;
  }

  /* --- curvature and reversals ------------------------------------------ */

  const curvatures: number[] = [];
  let totalAngle = 0;
  let reversals = 0;
  let terminalReversals = 0;

  const terminalStart = Math.floor(samples.length * 0.75);

  for (let i = 1; i < headings.length; i += 1) {
    const delta = angleDelta(headings[i]!, headings[i - 1]!);
    totalAngle += delta;
    const step = steps[headingIndex[i]!]!;
    if (step > 1e-9) curvatures.push(delta / step);
    if (delta > REVERSAL_ANGLE) {
      reversals += 1;
      if (headingIndex[i]! >= terminalStart) terminalReversals += 1;
    }
  }

  const curvatureMean = mean(curvatures);
  let curvatureMax = 0;
  for (const value of curvatures) if (value > curvatureMax) curvatureMax = value;

  /* --- pauses, submovements, braking ------------------------------------ */

  let pauseFrames = 0;
  let pauseRuns = 0;
  let inPause = false;
  for (const speed of speeds) {
    if (speed < PAUSE_SPEED) {
      pauseFrames += 1;
      if (!inPause) {
        pauseRuns += 1;
        inPause = true;
      }
    } else {
      inPause = false;
    }
  }

  const submovements = countSubmovements(speeds);

  const terminalFrom = Math.floor(speeds.length * 0.85);
  const terminalSpeeds = speeds.slice(terminalFrom);
  const terminalRatio = safeDiv(mean(terminalSpeeds), speedMean, 1);

  /* --- durations -------------------------------------------------------- */

  // Measured on the resampled grid, not on the original wall clock, so that a
  // dropped-frame augmentation cannot change duration and speed inconsistently.
  const movementSeconds = Math.max(1e-3, (last.t - first.t) / 1000);
  const totalSeconds = Math.max(
    movementSeconds,
    (stroke.endedAt - stroke.startedAt) / 1000,
  );
  const gapSeconds = Math.max(0, stroke.gapBefore / 1000);

  const out = new Float32Array(FEATURE_COUNT);
  let k = 0;

  out[k++] = Math.log1p(totalSeconds);
  out[k++] = pathLength;
  out[k++] = netDistance;
  out[k++] = straightness;
  out[k++] = Math.log1p(gapSeconds);

  out[k++] = speedMean;
  out[k++] = speedStd;
  out[k++] = speedMax;
  out[k++] = median(speeds);
  out[k++] = safeDiv(speedStd, speedMean);
  out[k++] = safeDiv(speedMean, speedMax);
  out[k++] = timeToPeak;
  out[k++] = safeDiv(aboveHalf, speeds.length);

  out[k++] = mean(accelAbs);
  out[k++] = std(accelerations, accelMean);
  out[k++] = accelMax;
  out[k++] = accelMin;
  out[k++] = safeDiv(accelPositive, accelerations.length);

  out[k++] = mean(jerks.map(Math.abs));
  out[k++] = std(jerks, jerkMean);
  out[k++] = safeDiv(jerkSignChanges, movementSeconds);

  out[k++] = curvatureMean;
  out[k++] = std(curvatures, curvatureMean);
  out[k++] = curvatureMax;
  out[k++] = totalAngle;
  out[k++] = Math.log1p(safeDiv(reversals, movementSeconds));
  out[k++] = safeDiv(maxDeviation, netLength);

  out[k++] = Math.log1p(pauseRuns);
  out[k++] = safeDiv(pauseFrames, speeds.length);
  out[k++] = Math.log1p(submovements);
  out[k++] = terminalRatio;
  out[k++] = Math.log1p(safeDiv(terminalReversals, movementSeconds));

  out[k++] = stroke.terminator === "click" ? 1 : 0;
  out[k++] = stroke.dragging ? 1 : 0;

  // A NaN here would silently poison a whole training batch, so fail loudly
  // instead: the caller drops the stroke.
  for (let i = 0; i < out.length; i += 1) {
    if (!Number.isFinite(out[i]!)) return null;
  }

  return out;
}
