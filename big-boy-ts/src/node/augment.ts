/**
 * Trajectory-level augmentation (description.md §5.4).
 *
 * Applied to the *raw* stroke before feature extraction, never to the finished
 * feature vector. Perturbing a feature vector directly would produce vectors
 * that no real trajectory could generate — the internal consistency between
 * duration, path length, speed and jerk would break, and the encoder would
 * learn to exploit exactly that inconsistency.
 */

import type { Stroke } from "../shared/types.ts";

export type AugmentConfig = {
  /** Time warp, ±this fraction (0.15 → speeds change by up to 15%). */
  timeWarp: number;
  /** Spatial scaling, ±this fraction — stands in for DPI / pointer accel. */
  spatialScale: number;
  /** Gaussian position jitter, in viewport diagonals. */
  jitter: number;
  /** Probability that any given sample is dropped (simulated frame loss). */
  dropRate: number;
  /** Probability of truncating a stroke, and the most that may be cut. */
  truncateProbability: number;
  maxTruncate: number;
};

export const DEFAULT_AUGMENT: AugmentConfig = {
  timeWarp: 0.15,
  spatialScale: 0.12,
  jitter: 0.0015,
  dropRate: 0.05,
  truncateProbability: 0.25,
  maxTruncate: 0.2,
};

/** Small deterministic PRNG so an augmented dataset can be reproduced exactly. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** One augmented copy of a stroke. `diagonal` scales the jitter to the screen. */
export function augmentStroke(
  stroke: Stroke,
  diagonal: number,
  rng: () => number,
  config: AugmentConfig = DEFAULT_AUGMENT,
): Stroke {
  const uniform = (spread: number): number => 1 + (rng() * 2 - 1) * spread;

  const timeScale = uniform(config.timeWarp);
  const spaceScale = uniform(config.spatialScale);
  const jitterPx = config.jitter * diagonal;

  // Box-Muller, reused for both axes.
  const gauss = (): number => {
    const u = Math.max(1e-9, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const origin = stroke.samples[0]!;
  let samples = stroke.samples.map((sample, index) => ({
    // The first sample stays put so the stroke keeps its start time; only the
    // intervals stretch.
    t: origin.t + (sample.t - origin.t) * timeScale,
    x: origin.x + (sample.x - origin.x) * spaceScale + (index === 0 ? 0 : gauss() * jitterPx),
    y: origin.y + (sample.y - origin.y) * spaceScale + (index === 0 ? 0 : gauss() * jitterPx),
  }));

  if (config.dropRate > 0) {
    const kept = samples.filter(
      (_, index) => index === 0 || index === samples.length - 1 || rng() >= config.dropRate,
    );
    // Never drop below what the extractor needs — an over-thinned stroke would
    // just be discarded, wasting the augmentation slot.
    if (kept.length >= 6) samples = kept;
  }

  if (rng() < config.truncateProbability && samples.length > 8) {
    const cut = Math.floor(samples.length * rng() * config.maxTruncate);
    if (cut > 0 && samples.length - cut >= 6) samples = samples.slice(0, samples.length - cut);
  }

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const truncated = samples.length < stroke.samples.length;

  return {
    samples,
    startedAt: first.t,
    // A truncated stroke no longer reaches its terminating click, so its
    // recorded end time must follow the trajectory rather than the original.
    endedAt: truncated ? last.t : first.t + (stroke.endedAt - stroke.startedAt) * timeScale,
    terminator: truncated ? "end" : stroke.terminator,
    dragging: stroke.dragging,
    gapBefore: stroke.gapBefore * timeScale,
  };
}
