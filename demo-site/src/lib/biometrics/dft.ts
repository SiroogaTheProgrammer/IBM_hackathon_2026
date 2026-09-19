/**
 * Minimal DFT/interpolation helpers for the spectral (FFT) mouse features.
 * Window sizes here are tiny (a ~1 s mouse burst resampled to 50 Hz is on the
 * order of 50-150 samples), so a direct O(n^2) DFT is more than fast enough
 * and avoids pulling in an FFT dependency for a Vercel function.
 */

export function linspace(start: number, stop: number, num: number): number[] {
  if (num <= 1) return [start];
  const step = (stop - start) / (num - 1);
  return Array.from({ length: num }, (_, i) => start + i * step);
}

/** Equivalent of `np.interp`: `xp` must be sorted ascending; values outside
 * the range are clamped to the first/last `fp` value. */
export function interp(xs: number[], xp: number[], fp: number[]): number[] {
  return xs.map((x) => {
    if (x <= xp[0]) return fp[0];
    if (x >= xp[xp.length - 1]) return fp[fp.length - 1];
    let lo = 0;
    let hi = xp.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xp[mid] <= x) lo = mid;
      else hi = mid;
    }
    const x0 = xp[lo];
    const x1 = xp[hi];
    const y0 = fp[lo];
    const y1 = fp[hi];
    if (x1 === x0) return y0;
    return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  });
}

export function hanning(n: number): number[] {
  if (n <= 1) return new Array(n).fill(1);
  return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
}

/** Magnitude spectrum equivalent to `np.abs(np.fft.rfft(signal))`. */
export function rfftMagnitude(signal: number[]): number[] {
  const n = signal.length;
  const nFreq = Math.floor(n / 2) + 1;
  const mags = new Array(nFreq);
  for (let k = 0; k < nFreq; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      re += signal[t] * Math.cos(angle);
      im += signal[t] * Math.sin(angle);
    }
    mags[k] = Math.hypot(re, im);
  }
  return mags;
}

/** Equivalent of `np.fft.rfftfreq(n, d)`. */
export function rfftFreqs(n: number, d: number): number[] {
  const nFreq = Math.floor(n / 2) + 1;
  return Array.from({ length: nFreq }, (_, k) => k / (n * d));
}
