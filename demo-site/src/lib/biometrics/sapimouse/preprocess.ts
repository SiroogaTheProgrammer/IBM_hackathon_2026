/**
 * Port of `apply_preprocessor`. Order matters and matches the fitted object:
 * log1p (on the columns chosen at fit time) -> clip to median +/- 6 MAD ->
 * fill missing -> centre and scale.
 *
 * All bounds and scales were fitted on the TRAINING FOLD ONLY. Nothing here is
 * computed from the data being scored, which is why a single session can be
 * preprocessed on its own and still land in the same space as training.
 */
import type { FeatureRow } from "./features";

export type Preprocessor = {
  features: string[];
  log_cols: string[];
  lo: Record<string, number>;
  hi: Record<string, number>;
  fill: Record<string, number>;
  center: Record<string, number>;
  scale: Record<string, number>;
};

export function applyPreprocessor(rows: FeatureRow[], pre: Preprocessor): Float32Array[] {
  const logSet = new Set(pre.log_cols.filter((c) => pre.features.includes(c)));
  return rows.map((row) => {
    const out = new Float32Array(pre.features.length);
    pre.features.forEach((c, j) => {
      const val = row[c];
      let x = val === null || val === undefined || !Number.isFinite(val)
        ? Number.NaN : Number(val);
      if (logSet.has(c) && !Number.isNaN(x)) x = Math.log1p(Math.max(x, -0.999999));
      if (!Number.isNaN(x)) x = Math.min(Math.max(x, pre.lo[c]), pre.hi[c]);
      if (Number.isNaN(x)) x = pre.fill[c];
      x = (x - pre.center[c]) / pre.scale[c];
      out[j] = Number.isFinite(x) ? x : 0;
    });
    return out;
  });
}
