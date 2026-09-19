/**
 * TypeScript port of `behavioral_biometrics_nn/feature_extractor.py`'s
 * `extract_window_features`: the 32-feature vector computed per ~1 s window
 * of raw pointer events. Field names/units match what `BiometricsWidget.tsx`
 * already sends (`{t, x, y, button, state}`, with `button`/`state` using the
 * same string vocabulary as the Balabit-style training data: button in
 * "NoButton"/"Left"/"Right"/"Scroll", state in
 * "Move"/"Drag"/"Pressed"/"Released"/"Up"/"Down").
 *
 * Keyboard slots (features 21-26) are always zero here: the live browser
 * widget only ever puts mouse events in `events` (keystrokes go to the
 * separate `keys` array consumed by the keystroke module), exactly mirroring
 * how the Python `MouseBaseModule` never sees key events in its `events`
 * telemetry either.
 */

import { clip, mean, pstd, pyMod } from "./math";
import { hanning, interp, linspace, rfftFreqs, rfftMagnitude } from "./dft";
import type { MouseEvent2D } from "./types";

const PAUSE_THRESHOLD_S = 0.2;
const DOUBLE_CLICK_MAX_S = 1.0;
const RESAMPLE_HZ = 50.0;
const TREMOR_BAND_HZ: [number, number] = [8.0, 12.0];
const MOVEMENT_STATES = new Set(["Move", "Drag"]);

export const MIN_MOVE_EVENTS = 4;
export const N_FEATURES = 32;

function diff(xs: number[]): number[] {
  const out = new Array(Math.max(xs.length - 1, 0));
  for (let i = 1; i < xs.length; i++) out[i - 1] = xs[i] - xs[i - 1];
  return out;
}

function movementArrays(window: MouseEvent2D[]) {
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (const e of window) {
    if (MOVEMENT_STATES.has(e.state)) {
      t.push(e.t);
      x.push(e.x);
      y.push(e.y);
    }
  }
  return { t, x, y };
}

export function countMovementEvents(window: MouseEvent2D[]): number {
  let n = 0;
  for (const e of window) if (MOVEMENT_STATES.has(e.state)) n++;
  return n;
}

/** step/dt filtered to dt > 0, paired with the later timestamp of each pair. */
function velocityStage(t: number[], x: number[], y: number[]): { v: number[]; t: number[] } {
  const v: number[] = [];
  const tv: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt > 0) {
      v.push(Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) / dt);
      tv.push(t[i]);
    }
  }
  return { v, t: tv };
}

/** Generic diff(value)/diff(t) filtered to dt > 0 - reused for acceleration
 * (from velocity) and jerk (from acceleration). */
function rateOfChange(t: number[], v: number[]): { v: number[]; t: number[] } {
  const out: number[] = [];
  const tout: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt > 0) {
      out.push((v[i] - v[i - 1]) / dt);
      tout.push(t[i]);
    }
  }
  return { v: out, t: tout };
}

function kinematics(t: number[], x: number[], y: number[]): number[] {
  if (t.length < 2) return new Array(8).fill(0);
  const { v, t: tv } = velocityStage(t, x, y);
  if (v.length === 0) return new Array(8).fill(0);
  const vStats = [mean(v), Math.max(...v), pstd(v)];

  let aStats = [0, 0, 0];
  let jStats = [0, 0];
  if (v.length >= 2) {
    const { v: a, t: ta } = rateOfChange(tv, v);
    if (a.length > 0) {
      aStats = [mean(a), Math.max(...a), pstd(a)];
      if (a.length >= 2) {
        const { v: j } = rateOfChange(ta, a);
        if (j.length > 0) jStats = [mean(j), Math.max(...j)];
      }
    }
  }
  return [...vStats, ...aStats, ...jStats];
}

function signChanges(delta: number[]): number {
  const signs = delta.map(Math.sign).filter((s) => s !== 0);
  if (signs.length < 2) return 0;
  let count = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) count++;
  return count;
}

function geometry(t: number[], x: number[], y: number[]): number[] {
  if (t.length < 2) return new Array(6).fill(0);
  const dx = diff(x);
  const dy = diff(y);
  const step = dx.map((d, i) => Math.hypot(d, dy[i]));
  const totalDistance = step.reduce((a, b) => a + b, 0);
  const directDistance = Math.hypot(x[x.length - 1] - x[0], y[y.length - 1] - y[0]);
  const pathEfficiency = totalDistance > 0 ? directDistance / totalDistance : 0;

  const movedIdx: number[] = [];
  step.forEach((s, i) => {
    if (s > 0) movedIdx.push(i);
  });

  let totalCurvature = 0;
  let meanAngularVelocity = 0;
  if (movedIdx.length >= 2) {
    const theta = movedIdx.map((i) => Math.atan2(dy[i], dx[i]));
    const dTheta: number[] = [];
    for (let i = 1; i < theta.length; i++) {
      const raw = theta[i] - theta[i - 1];
      dTheta.push(pyMod(raw + Math.PI, 2 * Math.PI) - Math.PI);
    }
    totalCurvature = dTheta.reduce((a, b) => a + Math.abs(b), 0);
    const tMoved = movedIdx.map((i) => t[i + 1]);
    const dtTheta = diff(tMoved);
    const rates: number[] = [];
    dtTheta.forEach((d, i) => {
      if (d > 0) rates.push(Math.abs(dTheta[i]) / d);
    });
    if (rates.length > 0) meanAngularVelocity = mean(rates);
  }

  const dirChangesX = signChanges(dx);
  const dirChangesY = signChanges(dy);

  let inflectionPoints = 0;
  if (dx.length >= 2) {
    const cross: number[] = [];
    for (let i = 0; i < dx.length - 1; i++) cross.push(dx[i] * dy[i + 1] - dy[i] * dx[i + 1]);
    const signs = cross.map(Math.sign).filter((s) => s !== 0);
    if (signs.length >= 2) {
      let count = 0;
      for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) count++;
      inflectionPoints = count;
    }
  }

  return [pathEfficiency, totalCurvature, meanAngularVelocity, dirChangesX, dirChangesY, inflectionPoints];
}

function rhythm(window: MouseEvent2D[], tMove: number[]): number[] {
  const dwellTimes: number[] = [];
  const pressOpen = new Map<string, number>();
  const pressTimes = new Map<string, number[]>();

  for (const e of window) {
    if (e.button === "NoButton" || e.button === "Scroll") continue;
    if (e.state === "Pressed") {
      pressOpen.set(e.button, e.t);
      const arr = pressTimes.get(e.button) ?? [];
      arr.push(e.t);
      pressTimes.set(e.button, arr);
    } else if (e.state === "Released") {
      const start = pressOpen.get(e.button);
      if (start !== undefined) {
        pressOpen.delete(e.button);
        if (e.t >= start) dwellTimes.push(e.t - start);
      }
    }
  }

  const clickDwellMean = dwellTimes.length ? mean(dwellTimes) : 0;
  const clickDwellStd = dwellTimes.length > 1 ? pstd(dwellTimes) : 0;

  let pauseCount = 0;
  let pauseTotal = 0;
  if (tMove.length >= 2) {
    for (const g of diff(tMove)) {
      if (g > PAUSE_THRESHOLD_S) {
        pauseCount++;
        pauseTotal += g;
      }
    }
  }

  const windowDuration = window.length >= 2 ? window[window.length - 1].t - window[0].t : 0;
  const pauseRatio = windowDuration > 0 ? clip(pauseTotal / windowDuration, 0, 1) : 0;

  const latencies: number[] = [];
  for (const times of pressTimes.values()) {
    if (times.length < 2) continue;
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1];
      if (d > 0 && d <= DOUBLE_CLICK_MAX_S) latencies.push(d);
    }
  }
  const doubleClickLatency = latencies.length ? mean(latencies) : 0;

  const hovers: number[] = [];
  if (tMove.length) {
    for (const e of window) {
      if (e.state !== "Pressed" || e.button === "NoButton" || e.button === "Scroll") continue;
      let before = -Infinity;
      for (const tm of tMove) if (tm <= e.t && tm > before) before = tm;
      if (before !== -Infinity) hovers.push(e.t - before);
    }
  }
  const hoverDurationMean = hovers.length ? mean(hovers) : 0;

  return [clickDwellMean, clickDwellStd, pauseCount, pauseRatio, doubleClickLatency, hoverDurationMean];
}

function spectral(t: number[], x: number[], y: number[]): number[] {
  if (t.length < 8) return [0, 0, 0, 0];

  const uniqueT: number[] = [];
  const uniqueX: number[] = [];
  const uniqueY: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (i === 0 || t[i] !== t[i - 1]) {
      uniqueT.push(t[i]);
      uniqueX.push(x[i]);
      uniqueY.push(y[i]);
    }
  }
  if (uniqueT.length < 8) return [0, 0, 0, 0];
  const duration = uniqueT[uniqueT.length - 1] - uniqueT[0];
  if (duration <= 0) return [0, 0, 0, 0];

  const n = Math.floor(duration * RESAMPLE_HZ) + 1;
  if (n < 8) return [0, 0, 0, 0];

  const grid = linspace(uniqueT[0], uniqueT[uniqueT.length - 1], n);
  let xi = interp(grid, uniqueT, uniqueX);
  let yi = interp(grid, uniqueT, uniqueY);

  const taper = hanning(n);
  const xMean = mean(xi);
  const yMean = mean(yi);
  xi = xi.map((v, i) => (v - xMean) * taper[i]);
  yi = yi.map((v, i) => (v - yMean) * taper[i]);

  const freqs = rfftFreqs(n, 1 / RESAMPLE_HZ);
  if (freqs.length < 2) return [0, 0, 0, 0];
  const magX = rfftMagnitude(xi);
  const magY = rfftMagnitude(yi);

  const argmaxFrom1 = (mags: number[]) => {
    let best = 1;
    let bestVal = mags[1] ?? 0;
    for (let i = 2; i < mags.length; i++) {
      if (mags[i] > bestVal) {
        bestVal = mags[i];
        best = i;
      }
    }
    return best;
  };
  const peakX = freqs[argmaxFrom1(magX)];
  const peakY = freqs[argmaxFrom1(magY)];

  const power = magX.map((m, i) => m * m + magY[i] * magY[i]);
  const totalPower = power.reduce((a, b) => a + b, 0);

  let tremorEnergy = 0;
  if (totalPower > 0) {
    let bandSum = 0;
    power.forEach((p, i) => {
      const f = freqs[i];
      if (f >= TREMOR_BAND_HZ[0] && f <= TREMOR_BAND_HZ[1]) bandSum += p;
    });
    tremorEnergy = bandSum / totalPower;
  }

  let spectralEntropy = 0;
  if (totalPower > 0) {
    const p = power.map((v) => v / totalPower).filter((v) => v > 0);
    spectralEntropy = -p.reduce((a, v) => a + v * Math.log2(v), 0);
  }

  return [peakX, peakY, tremorEnergy, spectralEntropy];
}

function scrollFeatures(window: MouseEvent2D[]): number[] {
  const times: number[] = [];
  const deltas: number[] = [];
  for (const e of window) {
    if (e.button !== "Scroll") continue;
    if (e.state === "Up") deltas.push(1);
    else if (e.state === "Down") deltas.push(-1);
    else continue;
    times.push(e.t);
  }
  if (times.length < 2) return [0, 0];

  const dt = diff(times);
  const rates: number[] = [];
  for (let i = 0; i < dt.length; i++) if (dt[i] > 0) rates.push(Math.abs(deltas[i + 1]) / dt[i]);
  const speed = rates.length ? mean(rates) : 0;

  const signs = deltas.map(Math.sign).filter((s) => s !== 0);
  let reversals = 0;
  if (signs.length >= 2) for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) reversals++;

  return [speed, reversals];
}

/** Compute the 32-feature vector for one ~1 s batch of raw mouse events. */
export function extractWindowFeatures(window: MouseEvent2D[]): number[] {
  const sorted = [...window].sort((a, b) => a.t - b.t);
  const { t, x, y } = movementArrays(sorted);

  const features = [
    ...kinematics(t, x, y),
    ...geometry(t, x, y),
    ...rhythm(sorted, t),
    0, 0, 0, 0, 0, 0, // keyboard slots 21-26: always zero, see module docstring
    ...spectral(t, x, y),
    ...scrollFeatures(sorted),
  ];

  if (features.length !== N_FEATURES) {
    throw new Error(`expected ${N_FEATURES} features, built ${features.length}`);
  }
  return features.map((v) => (Number.isFinite(v) ? v : 0));
}
