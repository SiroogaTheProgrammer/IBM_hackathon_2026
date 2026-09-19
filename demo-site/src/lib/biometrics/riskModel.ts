/**
 * Replacement for `behavioral_biometrics_nn.scorer.UserRiskModel`'s LightGBM
 * classifier: LightGBM is a native-binary dependency far too heavy for a
 * Vercel serverless function, so this fits a small L2-regularised logistic
 * regression instead, over the same 7 `_distance_stats` features. At this
 * scale (dozens to a few hundred rows, 7 features, trained fresh once per
 * session at the end of warm-up) it is fast enough to fit synchronously in a
 * single request and plenty accurate as a live anomaly gate.
 *
 * `smoothRisk`/`trailingMeanSeries` port `scorer.py`'s `smooth_risk`: a
 * causal (trailing, not centred) mean of the risk stream.
 */

import { clip, quantile, sigmoid } from "./math";

export type RiskModel = {
  w: number[];
  b: number;
  mean: number[];
  std: number[];
};

function standardize(rows: number[][]): { norm: number[][]; mean: number[]; std: number[] } {
  const d = rows[0]?.length ?? 0;
  const mean = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j] / rows.length;
  const variance = new Array(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j++) variance[j] += (r[j] - mean[j]) ** 2 / rows.length;
  const std = variance.map((v) => Math.sqrt(v) || 1);
  const norm = rows.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  return { norm, mean, std };
}

/** Fit gallery windows (label 0, "genuine") vs a background sample from other
 * users (label 1, "impostor") via batch gradient descent. */
export function fitRiskModel(genuineFeatures: number[][], impostorFeatures: number[][]): RiskModel {
  const rows = [...genuineFeatures, ...impostorFeatures];
  const labels = [...genuineFeatures.map(() => 0), ...impostorFeatures.map(() => 1)];
  const { norm, mean, std } = standardize(rows);

  const d = norm[0]?.length ?? 0;
  const w = new Array(d).fill(0);
  let b = 0;
  const lr = 0.3;
  const l2 = 1e-3;
  const epochs = 300;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < norm.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * norm[i][j];
      const err = sigmoid(z) - labels[i];
      for (let j = 0; j < d; j++) gradW[j] += err * norm[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gradW[j] / norm.length + l2 * w[j]);
    b -= lr * (gradB / norm.length);
  }

  return { w, b, mean, std };
}

/** Risk score in [0, 1]: 0 looks like the enrolled user, 1 looks like an
 * impostor - same convention as `UserRiskModel.risk`. */
export function riskScore(model: RiskModel, features: number[]): number {
  let z = model.b;
  for (let j = 0; j < features.length; j++) {
    z += model.w[j] * ((features[j] - model.mean[j]) / model.std[j]);
  }
  return sigmoid(z);
}

/** Causal trailing mean over the whole series - use only for one-shot
 * calibration (e.g. over the gallery's leave-one-out scores); live per-tick
 * scoring uses `smoothRisk` over a small capped history tail instead. */
export function trailingMeanSeries(xs: number[], window: number): number[] {
  if (window <= 1 || xs.length === 0) return xs.slice();
  const out = new Array(xs.length);
  const cumulative = new Array(xs.length + 1).fill(0);
  for (let i = 0; i < xs.length; i++) cumulative[i + 1] = cumulative[i] + xs[i];
  for (let i = 0; i < xs.length; i++) {
    const start = Math.max(0, i - window + 1);
    out[i] = (cumulative[i + 1] - cumulative[start]) / (i - start + 1);
  }
  return out;
}

/** Trailing mean of the most recent `window` raw risk values - the live,
 * per-tick equivalent of `trailingMeanSeries(...).at(-1)` without needing to
 * keep the full risk history in session state. */
export function smoothRisk(recentTail: number[], window: number): number {
  if (recentTail.length === 0) return 0;
  const slice = recentTail.slice(Math.max(0, recentTail.length - window));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Quantile-based threshold calibration, matching
 * `UserRiskModel.calibrate_from_gallery` / `.fit`'s calibration step. */
export function calibrateThreshold(scores: number[], targetFalseAlarm: number): number {
  return clip(quantile(scores, 1 - targetFalseAlarm), 0.05, 0.999);
}
