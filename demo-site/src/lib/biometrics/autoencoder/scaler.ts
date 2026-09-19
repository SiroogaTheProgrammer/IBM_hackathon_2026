/**
 * Feature standardisation for window-level features.
 *
 * Kinematic features are heavy-tailed - a single flick of the mouse produces a
 * max-jerk value orders of magnitude above the median. Plain standardisation
 * leaves those outliers dominating the reconstruction MSE, so we apply the
 * same treatment the live pipeline uses (../scaler.ts): signed log1p to
 * compress the tails, then standardise, then clip.
 */

import { clip, signedLog1p } from "../math";

export interface Scaler {
  mean: number[];
  scale: number[];
  /** Post-standardisation clamp, in standard deviations. */
  clip: number;
}

export const DEFAULT_CLIP = 5;

export function fitScaler(data: Float32Array, rows: number, dim: number): Scaler {
  const mean = new Float64Array(dim);
  const m2 = new Float64Array(dim);

  // Welford, on the log-compressed values the model will actually see.
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    for (let c = 0; c < dim; c++) {
      const v = signedLog1p(data[off + c]);
      const delta = v - mean[c];
      mean[c] += delta / (r + 1);
      m2[c] += delta * (v - mean[c]);
    }
  }

  const scale = new Float64Array(dim);
  for (let c = 0; c < dim; c++) {
    const sd = Math.sqrt(m2[c] / rows);
    // sklearn maps a zero-variance column to scale 1 so it transforms to 0.
    scale[c] = sd > 1e-12 ? sd : 1;
  }

  return { mean: Array.from(mean), scale: Array.from(scale), clip: DEFAULT_CLIP };
}

/** In-place standardisation. */
export function applyScaler(data: Float32Array, rows: number, dim: number, scaler: Scaler): void {
  const { mean, scale } = scaler;
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    for (let c = 0; c < dim; c++) {
      const z = (signedLog1p(data[off + c]) - mean[c]) / scale[c];
      data[off + c] = clip(z, -scaler.clip, scaler.clip);
    }
  }
}
