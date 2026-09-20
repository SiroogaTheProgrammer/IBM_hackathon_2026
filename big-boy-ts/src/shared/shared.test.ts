/**
 * Tests for the code that runs on both sides of the system.
 *
 * The point of these is narrow: anything that could make the browser compute a
 * different number from the trainer. Everything else is measured by the eval
 * harness, not asserted here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURE_COUNT, FEATURE_NAMES, extractStrokeFeatures } from "./features.ts";
import { FRAME_MS, resample60Hz } from "./resample.ts";
import { segmentStrokes } from "./strokes.ts";
import { applyScaler, fitScaler } from "./standardize.ts";
import { cosine, l2normalize, poolEmbeddings } from "./embed.ts";
import type { InputEvent, PointerSample, Stroke } from "./types.ts";

const DIAGONAL = Math.hypot(1280, 800);

/** A straight, smooth move from `from` to `to` sampled at an irregular rate. */
function glide(
  from: [number, number],
  to: [number, number],
  durationMs: number,
  startT = 0,
  stepMs = 17,
): PointerSample[] {
  const samples: PointerSample[] = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    const p = t / durationMs;
    // Minimum-jerk profile, so the speed curve has a real peak to find.
    const s = 10 * p ** 3 - 15 * p ** 4 + 6 * p ** 5;
    samples.push({
      t: startT + t,
      x: from[0] + (to[0] - from[0]) * s,
      y: from[1] + (to[1] - from[1]) * s,
    });
  }
  return samples;
}

function strokeFrom(samples: PointerSample[]): Stroke {
  return {
    samples,
    startedAt: samples[0]!.t,
    endedAt: samples[samples.length - 1]!.t,
    terminator: "click",
    dragging: false,
    gapBefore: 250,
  };
}

test("feature names and count stay in sync", () => {
  assert.equal(FEATURE_NAMES.length, FEATURE_COUNT);
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_COUNT, "feature names must be unique");
});

test("resampling lands on a uniform 60 Hz grid", () => {
  const samples = glide([100, 100], [800, 500], 500, 0, 23);
  const resampled = resample60Hz(samples);

  assert.ok(resampled.length > 25);
  for (let i = 1; i < resampled.length; i += 1) {
    const dt = resampled[i]!.t - resampled[i - 1]!.t;
    assert.ok(Math.abs(dt - FRAME_MS) < 1e-6, `frame ${i} spacing was ${dt}`);
  }
  // Endpoints are preserved to within one frame of interpolation.
  assert.ok(Math.abs(resampled[0]!.x - 100) < 1);
  assert.ok(Math.abs(resampled[resampled.length - 1]!.x - 800) < 20);
});

test("resampling makes the sampling rate irrelevant", () => {
  // The same physical movement logged at 8 ms and at 25 ms must produce
  // near-identical features — this is the whole reason §3.2 exists.
  const fast = extractStrokeFeatures(strokeFrom(glide([100, 100], [900, 600], 600, 0, 8)), {
    diagonal: DIAGONAL,
  });
  const slow = extractStrokeFeatures(strokeFrom(glide([100, 100], [900, 600], 600, 0, 25)), {
    diagonal: DIAGONAL,
  });

  assert.ok(fast && slow);
  for (const name of ["path_length", "net_distance", "speed_mean", "speed_max"] as const) {
    const index = FEATURE_NAMES.indexOf(name);
    const a = fast[index]!;
    const b = slow[index]!;
    assert.ok(
      Math.abs(a - b) / Math.max(1e-6, Math.abs(a)) < 0.05,
      `${name} differed by more than 5%: ${a} vs ${b}`,
    );
  }
});

test("features are viewport-invariant", () => {
  // The same gesture on a 1280-wide and a 2560-wide screen: distances are in
  // diagonals, so they must match (§3.3).
  const small = extractStrokeFeatures(strokeFrom(glide([100, 100], [900, 600], 600)), {
    diagonal: DIAGONAL,
  });
  const large = extractStrokeFeatures(
    strokeFrom(glide([200, 200], [1800, 1200], 600)),
    { diagonal: DIAGONAL * 2 },
  );

  assert.ok(small && large);
  const index = FEATURE_NAMES.indexOf("path_length");
  assert.ok(Math.abs(small[index]! - large[index]!) < 1e-3);
});

test("every feature is finite for a plausible stroke", () => {
  const features = extractStrokeFeatures(strokeFrom(glide([10, 10], [1200, 700], 900)), {
    diagonal: DIAGONAL,
  });
  assert.ok(features);
  features.forEach((value, index) => {
    assert.ok(Number.isFinite(value), `${FEATURE_NAMES[index]} was ${value}`);
  });
});

test("degenerate strokes are rejected rather than producing NaN", () => {
  const still: PointerSample[] = Array.from({ length: 40 }, (_, i) => ({
    t: i * 17,
    x: 500,
    y: 500,
  }));
  const features = extractStrokeFeatures(strokeFrom(still), { diagonal: DIAGONAL });
  // A stroke that never moved has no kinematics, but must never emit NaN.
  if (features) features.forEach((value) => assert.ok(Number.isFinite(value)));

  assert.equal(
    extractStrokeFeatures(strokeFrom(glide([0, 0], [10, 10], 20, 0, 10)), {
      diagonal: DIAGONAL,
    }),
    null,
  );
});

test("clicks and dwells split strokes", () => {
  const events: InputEvent[] = [];
  const push = (samples: PointerSample[]): void => {
    for (const s of samples) {
      events.push({ ...s, kind: "move", button: "none", dragging: false });
    }
  };

  push(glide([100, 100], [600, 400], 500, 0));
  const click = events[events.length - 1]!;
  events.push({ ...click, kind: "down", button: "left", dragging: false });
  events.push({ ...click, t: click.t + 40, kind: "up", button: "left", dragging: false });
  push(glide([600, 400], [1100, 200], 500, click.t + 400));

  const strokes = segmentStrokes(events, DIAGONAL);
  assert.ok(strokes.length >= 2, `expected at least 2 strokes, got ${strokes.length}`);
  assert.equal(strokes[0]!.terminator, "click");
  // The second stroke began after an idle period, which the features see.
  assert.ok(strokes[strokes.length - 1]!.gapBefore > 100);
});

test("scaler round-trips and clips", () => {
  const rows = Array.from({ length: 200 }, (_, i) => {
    const row = new Float32Array(FEATURE_COUNT);
    for (let k = 0; k < FEATURE_COUNT; k += 1) row[k] = Math.sin(i * 0.1 + k) * (k + 1);
    return row;
  });
  const scaler = fitScaler(rows);
  const scaled = applyScaler(rows[0]!, scaler);

  assert.equal(scaled.length, FEATURE_COUNT);
  scaled.forEach((value) => {
    assert.ok(Number.isFinite(value) && Math.abs(value) <= 6);
  });

  // A constant column must map to 0, not to ±Infinity.
  const constant = Array.from({ length: 10 }, () => new Float32Array(FEATURE_COUNT));
  const constantScaled = applyScaler(constant[0]!, fitScaler(constant));
  constantScaled.forEach((value) => assert.equal(value, 0));
});

test("embedding helpers behave on the unit sphere", () => {
  const a = l2normalize(Float32Array.from([3, 4, 0]));
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-6);
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6);

  const pooled = poolEmbeddings([
    l2normalize(Float32Array.from([1, 0, 0])),
    l2normalize(Float32Array.from([0, 1, 0])),
  ]);
  assert.ok(pooled);
  assert.ok(Math.abs(Math.hypot(...pooled) - 1) < 1e-6);
  assert.equal(poolEmbeddings([]), null);
});
