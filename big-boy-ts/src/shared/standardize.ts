/**
 * Feature standardisation (description.md §5.1 — "≈40-d, standardized").
 *
 * The statistics are fitted once on the training strokes and then shipped to
 * the client alongside the encoder weights. Refitting in the browser would be
 * a silent train/test mismatch, so the client only ever *applies* a scaler.
 */

import { FEATURE_COUNT, FEATURE_NAMES, FEATURE_VERSION } from "./features.ts";
import type { Scaler } from "./types.ts";

/** Standardised values are clipped here so one wild stroke cannot dominate. */
const CLIP = 6;

/** Fit per-feature mean and standard deviation over a training matrix. */
export function fitScaler(rows: Float32Array[]): Scaler {
  const mean = new Array<number>(FEATURE_COUNT).fill(0);
  const std = new Array<number>(FEATURE_COUNT).fill(0);
  if (rows.length === 0) {
    return { version: FEATURE_VERSION, names: FEATURE_NAMES, mean, std: std.map(() => 1) };
  }

  for (const row of rows) {
    for (let i = 0; i < FEATURE_COUNT; i += 1) mean[i]! += row[i]!;
  }
  for (let i = 0; i < FEATURE_COUNT; i += 1) mean[i]! /= rows.length;

  for (const row of rows) {
    for (let i = 0; i < FEATURE_COUNT; i += 1) std[i]! += (row[i]! - mean[i]!) ** 2;
  }
  for (let i = 0; i < FEATURE_COUNT; i += 1) {
    const variance = std[i]! / Math.max(1, rows.length - 1);
    // A constant feature gets std 1, which maps it to a constant 0 rather than
    // to ±Infinity.
    std[i] = Math.sqrt(variance) || 1;
  }

  return { version: FEATURE_VERSION, names: FEATURE_NAMES, mean, std };
}

/** Standardise one feature vector in place-safe fashion. */
export function applyScaler(row: Float32Array, scaler: Scaler): Float32Array {
  const out = new Float32Array(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const value = (row[i]! - (scaler.mean[i] ?? 0)) / (scaler.std[i] || 1);
    out[i] = Math.max(-CLIP, Math.min(CLIP, value));
  }
  return out;
}

/**
 * Guard against shipping an encoder and a scaler that were built from
 * different feature orders — the failure mode is a model that quietly scores
 * garbage rather than one that throws.
 */
export function assertScalerMatches(scaler: Scaler): void {
  if (scaler.version !== FEATURE_VERSION) {
    throw new Error(
      `scaler was fitted for feature set "${scaler.version}" but this build is "${FEATURE_VERSION}"`,
    );
  }
  if (scaler.mean.length !== FEATURE_COUNT || scaler.std.length !== FEATURE_COUNT) {
    throw new Error(
      `scaler has ${scaler.mean.length} features, expected ${FEATURE_COUNT}`,
    );
  }
}
