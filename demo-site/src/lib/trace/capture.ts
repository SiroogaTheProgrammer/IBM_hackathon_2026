/**
 * Client-side capture and feature extraction for one sub-task.
 *
 * Follows `description.md` §3–§4: `pointermove` with `getCoalescedEvents()` so
 * the browser's own coalescing does not silently downsample the trajectory,
 * a uniform 60 Hz resample before any kinematics are computed, and a
 * viewport-invariant feature vector (everything spatial is divided by the
 * viewport diagonal, everything about the landing is expressed relative to the
 * target element's bounding box).
 *
 * Nothing here leaves the browser: the provider keeps the vectors in memory for
 * the length of a session and throws them away on reload.
 */

/** One captured pointer position. `t` is `performance.now()` milliseconds. */
export type PointerSample = { t: number; x: number; y: number };

/**
 * Feature order is part of the on-the-wire contract between a captured run and
 * an enrollment template — append, never reorder.
 */
export const FEATURE_NAMES = [
  "duration",
  "path_length",
  "straightness",
  "speed_mean",
  "speed_max",
  "speed_std",
  "accel_abs_mean",
  "jerk_abs_mean",
  "pause_count",
  "time_to_peak_frac",
  "reversals",
  "endpoint_dx",
  "endpoint_dy",
  "approach_cos",
  "approach_sin",
  "idle_before_move",
  "dwell_before_click",
] as const;

export const FEATURE_COUNT = FEATURE_NAMES.length;

/**
 * Per-feature scale, used to turn a raw difference between two runs into a
 * comparable z-distance. These are rough within-user spreads eyeballed from the
 * feature definitions rather than fitted numbers; §6.4 replaces them with
 * scales measured on the calibration set.
 */
export const FEATURE_SCALE: number[] = [
  0.35, // duration           (log1p seconds)
  0.30, // path_length        (viewport diagonals)
  0.12, // straightness       (0..1)
  0.35, // speed_mean         (diagonals / s)
  0.80, // speed_max
  0.35, // speed_std
  4.00, // accel_abs_mean     (diagonals / s²)
  120.0, // jerk_abs_mean     (diagonals / s³)
  0.45, // pause_count        (log1p)
  0.22, // time_to_peak_frac  (0..1)
  0.45, // reversals          (log1p)
  0.22, // endpoint_dx        (fraction of target width, -0.5..0.5)
  0.22, // endpoint_dy
  0.45, // approach_cos
  0.45, // approach_sin
  0.45, // idle_before_move   (log1p seconds)
  0.40, // dwell_before_click (log1p seconds)
];

/** Movement slower than this (viewport diagonals per second) counts as a pause. */
const PAUSE_SPEED = 0.05;

/** The 60 Hz grid every trajectory is resampled onto before kinematics. */
const FRAME_MS = 1000 / 60;

/** A trajectory shorter than this carries no usable kinematics. */
const MIN_SAMPLES = 4;

/* ------------------------------------------------------------ recording --- */

/**
 * Accumulates the raw trajectory of the sub-task currently in progress. One
 * instance per sub-task; the provider swaps it out on every advance.
 */
export class SubtaskRecorder {
  readonly subtaskId: string;
  readonly startedAt: number;

  private samples: PointerSample[] = [];

  constructor(subtaskId: string, startedAt: number = performance.now()) {
    this.subtaskId = subtaskId;
    this.startedAt = startedAt;
  }

  /** Feed one `pointermove`, expanding it into its coalesced positions. */
  add(event: PointerEvent): void {
    const events =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
    const points = events.length > 0 ? events : [event];

    for (const point of points) {
      this.samples.push({
        t: point.timeStamp || performance.now(),
        x: point.clientX,
        y: point.clientY,
      });
    }
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /** The recorded trajectory, in capture order. */
  trajectory(): PointerSample[] {
    return this.samples;
  }
}

/* ---------------------------------------------------------- resampling --- */

/**
 * Linear resample onto a uniform 60 Hz grid. Applied identically to live
 * capture and to any replayed dataset, so speed and acceleration mean the same
 * thing at enrollment and at test time (§3.2).
 */
export function resample60Hz(samples: PointerSample[]): PointerSample[] {
  if (samples.length < 2) return samples;

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return samples;

  const span = last.t - first.t;
  if (span <= 0) return samples;

  const frames = Math.max(2, Math.floor(span / FRAME_MS) + 1);
  const out: PointerSample[] = [];
  let cursor = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const t = first.t + frame * FRAME_MS;

    while (
      cursor < samples.length - 2 &&
      (samples[cursor + 1]?.t ?? Infinity) < t
    ) {
      cursor += 1;
    }

    const a = samples[cursor];
    const b = samples[cursor + 1] ?? last;
    if (!a) break;

    const gap = b.t - a.t;
    const ratio = gap > 0 ? Math.min(1, Math.max(0, (t - a.t) / gap)) : 0;

    out.push({
      t,
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
    });
  }

  return out;
}

/* ------------------------------------------------------------ features --- */

export type ExtractInput = {
  samples: PointerSample[];
  /** When the sub-task became current. */
  startedAt: number;
  /** When its terminating interaction fired. */
  endedAt: number;
  /** Where the terminating click landed, in client coordinates. */
  endPoint: { x: number; y: number } | null;
  /** Bounding box of the `data-trace` element that was hit. */
  targetRect: { x: number; y: number; width: number; height: number } | null;
  viewport: { width: number; height: number };
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[], average = mean(values)): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

/** First differences of `values` with respect to a fixed `dt` in seconds. */
function derivative(values: number[], dt: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    out.push(((values[i] ?? 0) - (values[i - 1] ?? 0)) / dt);
  }
  return out;
}

/**
 * The ~17-d vector one sub-task contributes. Returns `null` when the sub-task
 * produced too little free cursor movement to describe — §6.1 skips those
 * rather than scoring them noisily.
 */
export function extractFeatures(input: ExtractInput): number[] | null {
  const { startedAt, endedAt, endPoint, targetRect, viewport } = input;

  const raw = input.samples;
  if (raw.length < MIN_SAMPLES) return null;

  const samples = resample60Hz(raw);
  if (samples.length < MIN_SAMPLES) return null;

  const diagonal =
    Math.hypot(viewport.width, viewport.height) || 1; /* never divide by 0 */
  const dt = FRAME_MS / 1000;

  /* --- geometry ---------------------------------------------------------- */

  const stepLengths: number[] = [];
  const headings: number[] = [];

  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    stepLengths.push(Math.hypot(dx, dy) / diagonal);
    if (dx !== 0 || dy !== 0) headings.push(Math.atan2(dy, dx));
  }

  const pathLength = stepLengths.reduce((sum, step) => sum + step, 0);
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;

  const netDistance = Math.hypot(last.x - first.x, last.y - first.y) / diagonal;
  const straightness = pathLength > 0 ? netDistance / pathLength : 0;

  /* --- kinematics -------------------------------------------------------- */

  const speeds = stepLengths.map((step) => step / dt);
  const accelerations = derivative(speeds, dt);
  const jerks = derivative(accelerations, dt);

  const speedMean = mean(speeds);
  const speedMax = speeds.reduce((max, value) => Math.max(max, value), 0);
  const speedStd = std(speeds, speedMean);

  const pauses = speeds.filter((speed) => speed < PAUSE_SPEED).length;

  const peakIndex = speeds.indexOf(speedMax);
  const timeToPeak =
    speeds.length > 1 ? Math.max(0, peakIndex) / (speeds.length - 1) : 0;

  let reversals = 0;
  for (let i = 1; i < headings.length; i += 1) {
    const previous = headings[i - 1] ?? 0;
    const current = headings[i] ?? 0;
    let delta = Math.abs(current - previous);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    if (delta > Math.PI / 2) reversals += 1;
  }

  /* --- landing ----------------------------------------------------------- */

  let endpointDx = 0;
  let endpointDy = 0;

  if (endPoint && targetRect && targetRect.width > 0 && targetRect.height > 0) {
    endpointDx =
      (endPoint.x - (targetRect.x + targetRect.width / 2)) / targetRect.width;
    endpointDy =
      (endPoint.y - (targetRect.y + targetRect.height / 2)) / targetRect.height;
  }

  /**
   * Approach angle over the last ~100 ms, as (cos, sin) so the wrap-around at
   * ±π does not turn two near-identical approaches into opposite numbers.
   */
  const approachFrom = samples[Math.max(0, samples.length - 7)] ?? first;
  const approachAngle = Math.atan2(
    last.y - approachFrom.y,
    last.x - approachFrom.x,
  );

  /* --- timing ------------------------------------------------------------ */

  const idleBeforeMove = Math.max(0, (first.t - startedAt) / 1000);
  const dwellBeforeClick = Math.max(0, (endedAt - last.t) / 1000);
  const duration = Math.max(0, (endedAt - startedAt) / 1000);

  return [
    Math.log1p(duration),
    pathLength,
    straightness,
    speedMean,
    speedMax,
    speedStd,
    mean(accelerations.map(Math.abs)),
    mean(jerks.map(Math.abs)),
    Math.log1p(pauses),
    timeToPeak,
    Math.log1p(reversals),
    clamp(endpointDx, -1.5, 1.5),
    clamp(endpointDy, -1.5, 1.5),
    Math.cos(approachAngle),
    Math.sin(approachAngle),
    Math.log1p(idleBeforeMove),
    Math.log1p(dwellBeforeClick),
  ];
}
