/**
 * TypeScript port of `_distance_stats` from
 * `behavioral_biometrics_nn/scorer.py`: cosine-distance statistics of a
 * single (already L2-normalised) query embedding against a gallery of
 * L2-normalised embeddings.
 *
 * `leaveOneOutIndex` mirrors the Python `leave_one_out=True` path used only
 * when the query IS one of the gallery rows (fitting/calibrating the risk
 * model from the gallery itself) - it masks that row out of every
 * statistic, including the centroid, so a vector never gets "credit" for
 * being distance 0 from itself.
 */

import { mean, median, percentile, pstd } from "./math";

export const N_DISTANCE_FEATURES = 7;

export function distanceStats(
  query: number[],
  gallery: number[][],
  leaveOneOutIndex?: number,
): number[] {
  const n = gallery.length;
  const dim = query.length;

  const cos: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (leaveOneOutIndex === i) {
      cos[i] = NaN;
      continue;
    }
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += query[d] * gallery[i][d];
    cos[i] = 1 - dot;
  }
  const finite = cos.filter((v) => Number.isFinite(v));

  const sorted = [...finite].sort((a, b) => a - b);
  const cosMin = sorted.length ? sorted[0] : 0;
  const k = Math.min(3, Math.max(n - 1, 1));
  const cosTop3 = sorted.length ? mean(sorted.slice(0, k)) : 0;
  const cosP25 = finite.length ? percentile(finite, 25) : 0;
  const cosMedian = finite.length ? median(finite) : 0;
  const cosMean = finite.length ? mean(finite) : 0;
  const cosStd = finite.length ? pstd(finite) : 0;

  // Centroid of the gallery, excluding the query's own row under leave-one-out.
  const centroid = new Array(dim).fill(0);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (leaveOneOutIndex === i) continue;
    for (let d = 0; d < dim; d++) centroid[d] += gallery[i][d];
    count++;
  }
  const denom = leaveOneOutIndex !== undefined ? Math.max(n - 1, 1) : Math.max(n, 1);
  for (let d = 0; d < dim; d++) centroid[d] /= denom || 1;
  void count;

  const centroidNorm = Math.sqrt(centroid.reduce((a, v) => a + v * v, 0));
  const centroidUnit = centroidNorm > 0 ? centroid.map((v) => v / centroidNorm) : centroid;
  let dotCentroid = 0;
  for (let d = 0; d < dim; d++) dotCentroid += query[d] * centroidUnit[d];
  const cosCentroid = 1 - dotCentroid;

  return [cosMin, cosTop3, cosP25, cosMedian, cosMean, cosStd, cosCentroid].map((v) =>
    Number.isFinite(v) ? v : 0,
  );
}
