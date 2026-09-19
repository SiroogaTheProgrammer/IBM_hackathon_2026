/**
 * `sklearn.preprocessing.StandardScaler`, as used by
 * `ML_Models/train_pipeline_1.py`: plain `(x - mean) / std`, nothing else.
 *
 * Deliberately *not* the sibling `autoencoder/scaler.ts`, which also applies
 * signed-log1p compression: that exists because window-level kinematics (max
 * jerk, peak velocity) are heavy-tailed, and the raw per-event columns here are
 * not - `x`/`y` are bounded by the viewport, and `time_delta` is capped in
 * features.ts. Keeping the transform linear is what makes this a port of the
 * Python pipeline rather than a second copy of the window model.
 *
 * The post-standardisation clamp, though, is not optional, and it is the one
 * place the Python original cannot be followed literally. `StandardScaler`
 * divides by the column's standard deviation, and `time_delta`'s deviation
 * collapses when the capture is evenly sampled - a steady 60 Hz pointer gives
 * sigma ~= 3e-4 s. A single row spanning a pause then standardises to z ~= 1.5e4
 * and contributes ~2e7 to that row's squared error, against a genuine mean
 * nearer 1e-4. Unclamped that one row dominates the training gradient during
 * enrolment and swamps the mean error of any tick it lands in. The recorded
 * Balabit CSVs the Python script was written against are continuous captures
 * where this barely shows; a live browser stream pauses constantly.
 */

export interface StandardScaler {
  mean: number[];
  /** Per-column standard deviation, with sklearn's zero-variance handling. */
  scale: number[];
  /** Post-standardisation clamp, in standard deviations. */
  clip: number;
}

/**
 * Wide enough that it never touches ordinary variation - a 5-sigma event is
 * already rare - but tight enough to bound one column's contribution to a row's
 * squared error at `clip^2`.
 */
export const DEFAULT_CLIP = 5;

export function fitStandardScaler(data: Float32Array, rows: number, dim: number): StandardScaler {
  const mean = new Float64Array(dim);
  const m2 = new Float64Array(dim);

  // Welford in a single pass: the naive sum-of-squares formula loses most of
  // its precision on the `x`/`y` columns, where the values are large (hundreds
  // of pixels) and the variance is comparatively small.
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    for (let c = 0; c < dim; c++) {
      const v = data[off + c];
      const delta = v - mean[c];
      mean[c] += delta / (r + 1);
      m2[c] += delta * (v - mean[c]);
    }
  }

  const scale = new Float64Array(dim);
  for (let c = 0; c < dim; c++) {
    const sd = Math.sqrt(m2[c] / rows);
    // sklearn maps a constant column to scale 1, so it transforms to exactly 0
    // rather than dividing by zero. The one-hot columns hit this routinely -
    // most sessions contain no right-click at all.
    scale[c] = sd > 1e-12 ? sd : 1;
  }

  return { mean: Array.from(mean), scale: Array.from(scale), clip: DEFAULT_CLIP };
}

/** In-place `transform`, with the clamp described above. */
export function applyStandardScaler(
  data: Float32Array,
  rows: number,
  dim: number,
  scaler: StandardScaler,
): void {
  const { mean, scale } = scaler;
  // Profiles written before `clip` existed would otherwise clamp everything to
  // zero; treat a missing value as "no clamp".
  const lim = scaler.clip ?? Infinity;
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    for (let c = 0; c < dim; c++) {
      const z = (data[off + c] - mean[c]) / scale[c];
      data[off + c] = z < -lim ? -lim : z > lim ? lim : z;
    }
  }
}
