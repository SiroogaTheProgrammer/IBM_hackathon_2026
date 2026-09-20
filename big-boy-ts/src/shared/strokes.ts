/**
 * Stroke segmentation (description.md §3.4).
 *
 * A stroke is a movement segment bounded by a click, a dwell longer than
 * ~100 ms, or a direction reversal taken below a velocity threshold. The same
 * routine runs over SapiMouse events and over live browser events, so a
 * "stroke" is the same object in training and at test time.
 */

import type { InputEvent, PointerSample, Stroke } from "./types.ts";

export type SegmentConfig = {
  /** Still for longer than this (ms) ends the stroke. */
  dwellMs: number;
  /** Speed below this (viewport diagonals / second) counts as still. */
  stillSpeed: number;
  /** A heading change larger than this (radians) is a reversal... */
  reversalAngle: number;
  /** ...but only when taken below this speed (diagonals / second). */
  reversalSpeed: number;
  /** Strokes shorter than this (raw samples) carry no usable kinematics. */
  minSamples: number;
  /** Strokes shorter than this (ms) are discarded. */
  minDurationMs: number;
  /** Strokes covering less than this (viewport diagonals) are discarded. */
  minDistance: number;
  /** A jump larger than this (ms) is a capture dropout, never a real dwell. */
  maxSampleGapMs: number;
};

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  dwellMs: 100,
  stillSpeed: 0.02,
  reversalAngle: (135 * Math.PI) / 180,
  reversalSpeed: 0.15,
  minSamples: 6,
  minDurationMs: 60,
  minDistance: 0.02,
  maxSampleGapMs: 2000,
};

/** Shortest angular difference between two headings, in [0, π]. */
function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * Split a stream of input events into strokes.
 *
 * `diagonal` is the viewport diagonal in the same units as `x`/`y`; it makes
 * the speed thresholds resolution-independent, so a 2560-wide SapiMouse
 * session and a 1280-wide demo viewport segment the same way.
 */
export function segmentStrokes(
  events: InputEvent[],
  diagonal: number,
  config: SegmentConfig = DEFAULT_SEGMENT_CONFIG,
): Stroke[] {
  const strokes: Stroke[] = [];
  if (events.length === 0) return strokes;

  const scale = diagonal > 0 ? diagonal : 1;

  let current: PointerSample[] = [];
  let dragging = false;
  let stillSince: number | null = null;
  let previousHeading: number | null = null;
  let previousEnd: number | null = null;

  const flush = (terminator: Stroke["terminator"], at: number): void => {
    const samples = current;
    current = [];
    previousHeading = null;
    stillSince = null;
    if (samples.length < config.minSamples) return;

    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const duration = last.t - first.t;
    if (duration < config.minDurationMs) return;

    let path = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      path += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (path / scale < config.minDistance) return;

    strokes.push({
      samples,
      startedAt: first.t,
      endedAt: Math.max(last.t, at),
      terminator,
      dragging,
      gapBefore: previousEnd === null ? 0 : Math.max(0, first.t - previousEnd),
    });
    previousEnd = last.t;
  };

  for (const event of events) {
    if (event.kind === "down" || event.kind === "up") {
      // A click always terminates the stroke it lands at the end of (§3.4).
      // The click position itself is appended so the landing point is exact.
      current.push({ t: event.t, x: event.x, y: event.y });
      flush("click", event.t);
      dragging = event.kind === "down";
      continue;
    }

    const previous = current[current.length - 1];

    if (previous) {
      const dt = event.t - previous.t;
      const dx = event.x - previous.x;
      const dy = event.y - previous.y;
      const step = Math.hypot(dx, dy) / scale;

      if (dt > config.maxSampleGapMs) {
        // Capture dropout or a break in the recording: end the stroke and
        // start clean rather than inventing a 20-second "pause" feature.
        flush("end", previous.t);
        current.push({ t: event.t, x: event.x, y: event.y });
        dragging = event.dragging;
        continue;
      }

      const speed = dt > 0 ? step / (dt / 1000) : 0;

      if (speed < config.stillSpeed) {
        stillSince ??= previous.t;
        if (event.t - stillSince > config.dwellMs) {
          flush("dwell", stillSince);
          current.push({ t: event.t, x: event.x, y: event.y });
          dragging = event.dragging;
          continue;
        }
      } else {
        stillSince = null;
      }

      if (step > 0) {
        const heading = Math.atan2(dy, dx);
        if (
          previousHeading !== null &&
          speed < config.reversalSpeed &&
          angleDelta(heading, previousHeading) > config.reversalAngle
        ) {
          flush("reversal", previous.t);
          current.push({ t: previous.t, x: previous.x, y: previous.y });
        }
        previousHeading = heading;
      }
    }

    current.push({ t: event.t, x: event.x, y: event.y });
    dragging = event.dragging;
  }

  const tail = current[current.length - 1];
  if (tail) flush("end", tail.t);

  return strokes;
}
