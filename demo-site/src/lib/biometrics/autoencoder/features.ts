/**
 * Window-level feature extraction.
 *
 * The first version of this module fed the autoencoder one vector per raw
 * event - [x, y, time_delta, button, state] - which carried no temporal
 * context. The reconstruction error ended up tracking how spread out a user's
 * cursor coordinates were rather than who they were: on the 10-user dataset
 * the owner's own model was the lowest-error model for only 2 of 10 users.
 *
 * So we reuse the 32-feature window extractor the live pipeline already runs
 * (../featureExtractor.ts): velocity/acceleration/jerk statistics, path
 * geometry and curvature, click rhythm and pauses, tremor spectrum, scroll
 * behaviour. Six of its 32 slots are keyboard placeholders that are always
 * zero for mouse telemetry, so they are dropped here - a constant input is
 * dead capacity in an autoencoder.
 */

import { extractWindowFeatures, countMovementEvents, MIN_MOVE_EVENTS } from "../featureExtractor";
import type { MouseEvent2D } from "../types";

/** Indices 20-25 of the 32-feature vector are the always-zero keyboard slots. */
const KEYBOARD_SLOTS: [number, number] = [20, 26];

export const WINDOW_FEATURE_DIM = 26;

/**
 * Window length in seconds. Matches BiometricsWidget's TICK_MS = 1000, so the
 * windows the model trains on are the same shape as the batches it will be
 * asked to score live.
 */
export const DEFAULT_WINDOW_SECONDS = 1.0;

/**
 * Stride between windows during live enrolment. A one-minute capture yields
 * only ~60 non-overlapping windows, far too few to fit even a model this
 * small, so enrolment oversamples with a quarter-second hop (~4x the rows).
 *
 * These rows are correlated, not independent - consecutive windows share 75%
 * of their events. train.ts splits off its threshold-calibration set from the
 * chronological tail, which keeps the overlap from straddling the split, but
 * the effective sample size is still closer to 60 than to 240. Offline
 * evaluation deliberately does not do this.
 */
export const ENROL_HOP_SECONDS = 0.25;

function mouseOnly(all: number[]): number[] {
  return [...all.slice(0, KEYBOARD_SLOTS[0]), ...all.slice(KEYBOARD_SLOTS[1])];
}

/**
 * Parse one session CSV into raw events. Hand-rolled rather than using a CSV
 * library: the files are millions of rows of a fixed six-column schema, and
 * the parse is the hot path.
 */
export function parseSessionCsv(text: string): MouseEvent2D[] {
  const lines = text.split("\n");
  const out: MouseEvent2D[] = [];

  for (let i = lines[0]?.startsWith("record timestamp") ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 5) continue;

    // record timestamp,client timestamp,button,state,x,y
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    const c3 = line.indexOf(",", c2 + 1);
    const c4 = line.indexOf(",", c3 + 1);
    const c5 = line.indexOf(",", c4 + 1);
    if (c5 < 0) continue;

    const t = +line.slice(0, c1);
    const x = +line.slice(c4 + 1, c5);
    const y = +line.slice(c5 + 1);
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    out.push({ t, x, y, button: line.slice(c2 + 1, c3), state: line.slice(c3 + 1, c4) });
  }

  return out;
}

/**
 * Slice one session's events into windows and featurise each.
 *
 * Each window is anchored at a real event time, so long idle gaps are stepped
 * over rather than emitting thousands of empty windows. Windows with too few
 * movement events are dropped rather than zero-filled: an idle second says
 * nothing about who is holding the mouse, and feeding near-empty windows in
 * teaches the model to reconstruct zeros.
 *
 * `hopSeconds` controls the stride between window starts. It defaults to
 * `windowSeconds` (non-overlapping), which is what offline evaluation uses so
 * that every training row is an independent observation. Live enrolment passes
 * a smaller hop to get enough rows out of a one-minute capture - see
 * ENROL_HOP_SECONDS.
 *
 * Callers must not concatenate sessions before calling this - each session
 * CSV has its own timeline starting at 0, so a window spanning the seam would
 * contain a bogus multi-hour time gap.
 */
export function eventsToWindowFeatures(
  events: MouseEvent2D[],
  windowSeconds: number = DEFAULT_WINDOW_SECONDS,
  hopSeconds: number = windowSeconds,
): { data: Float32Array; rows: number } {
  if (events.length === 0) return { data: new Float32Array(0), rows: 0 };

  const sorted = events.every((e, i) => i === 0 || e.t >= events[i - 1].t)
    ? events
    : [...events].sort((a, b) => a.t - b.t);

  const vectors: number[][] = [];
  const hop = Math.max(hopSeconds, 1e-3);

  let i = 0;
  while (i < sorted.length) {
    const startT = sorted[i].t;
    const endT = startT + windowSeconds;

    let j = i;
    while (j < sorted.length && sorted[j].t < endT) j++;

    const window = sorted.slice(i, j);
    if (window.length >= MIN_MOVE_EVENTS && countMovementEvents(window) >= MIN_MOVE_EVENTS) {
      vectors.push(mouseOnly(extractWindowFeatures(window)));
    }

    // Advance to the first event at least one hop past this window's start.
    // Anchoring on event times (rather than a fixed grid) is what skips idle
    // gaps; the `i + 1` floor guarantees forward progress.
    let next = i + 1;
    while (next < sorted.length && sorted[next].t < startT + hop) next++;
    i = next;
  }

  const data = new Float32Array(vectors.length * WINDOW_FEATURE_DIM);
  for (let k = 0; k < vectors.length; k++) data.set(vectors[k], k * WINDOW_FEATURE_DIM);
  return { data, rows: vectors.length };
}

/** Concatenate per-session window blocks into one matrix. */
export function concatWindows(blocks: { data: Float32Array; rows: number }[]): {
  data: Float32Array;
  rows: number;
} {
  const rows = blocks.reduce((a, b) => a + b.rows, 0);
  const out = new Float32Array(rows * WINDOW_FEATURE_DIM);
  let off = 0;
  for (const b of blocks) {
    out.set(b.data, off);
    off += b.rows * WINDOW_FEATURE_DIM;
  }
  return { data: out, rows };
}
