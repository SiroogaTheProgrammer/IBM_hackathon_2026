/** Small numeric helpers shared across the ported biometrics modules. */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

/** Population standard deviation (ddof=0), matching numpy's default `.std()`. */
export function pstd(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let s = 0;
  for (const v of xs) s += (v - m) ** 2;
  return Math.sqrt(s / xs.length);
}

export function signedLog1p(v: number): number {
  return Math.sign(v) * Math.log1p(Math.abs(v));
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function clip(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Python-style modulo: result always has the same sign as `n` (n > 0 here),
 * unlike JS's `%` which keeps the sign of the dividend. */
export function pyMod(x: number, n: number): number {
  return ((x % n) + n) % n;
}

/** Linear-interpolation percentile (0-100), matching numpy's default 'linear'
 * interpolation method. `xs` need not be pre-sorted. */
export function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0];
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function median(xs: number[]): number {
  return percentile(xs, 50);
}

/** `q` in [0, 1], matching numpy's `np.quantile` linear interpolation. */
export function quantile(xs: number[], q: number): number {
  return percentile(xs, q * 100);
}
