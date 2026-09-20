/**
 * Uniform 60 Hz resampling (description.md §3.2).
 *
 * SapiMouse is logged at ~17 ms with irregular gaps; a browser produces a
 * different sampling process again. Any speed, acceleration or jerk computed
 * on raw samples is therefore a *different signal* at train and test time.
 * Resampling both onto the same grid before deriving kinematics is the cheapest
 * available fix, so it happens here and nowhere else.
 */

import type { PointerSample } from "./types.ts";

/** The grid everything is resampled onto. */
export const FRAME_MS = 1000 / 60;

/** Seconds between two resampled frames — the `dt` every derivative uses. */
export const FRAME_S = FRAME_MS / 1000;

/**
 * Linear interpolation onto a uniform 60 Hz grid spanning `[t0, tN]`.
 *
 * Catmull-Rom was considered (§3.2 allows either). Linear is used because the
 * input is already dense relative to the output grid — SapiMouse at 17 ms and
 * coalesced `pointermove` at 4-8 ms both oversample a 16.7 ms grid — so spline
 * smoothing would mostly invent curvature that the jerk features would then
 * measure.
 */
export function resample60Hz(samples: PointerSample[]): PointerSample[] {
  if (samples.length < 2) return samples.slice();

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const span = last.t - first.t;
  if (span <= 0) return samples.slice();

  const frames = Math.max(2, Math.floor(span / FRAME_MS) + 1);
  const out: PointerSample[] = new Array(frames);
  let cursor = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const t = first.t + frame * FRAME_MS;

    // Advance to the last source sample at or before `t`.
    while (cursor < samples.length - 2 && samples[cursor + 1]!.t < t) cursor += 1;

    const a = samples[cursor]!;
    const b = samples[cursor + 1] ?? last;
    const gap = b.t - a.t;
    const ratio = gap > 0 ? Math.min(1, Math.max(0, (t - a.t) / gap)) : 0;

    out[frame] = {
      t,
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
    };
  }

  return out;
}
