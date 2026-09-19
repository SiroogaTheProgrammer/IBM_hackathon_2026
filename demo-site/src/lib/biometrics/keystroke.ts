/**
 * TypeScript port of the legacy (no-pretrained-model) fallback path in
 * `behavioral_biometrics_nn/modules/keystroke.py`'s `KeystrokeModule`: a
 * pure online z-score baseline over dwell/flight times, learned during
 * warm-up. Chosen deliberately over the module's *primary* path (a second
 * pretrained Siamese encoder + per-session gallery, mirroring the mouse
 * module) to avoid exporting/bundling a second neural net for this
 * serverless MVP - this fallback is a real, tested code path in the local
 * demo (used whenever `artifacts/keystroke/` hasn't been trained), not an
 * ad hoc simplification.
 */

import type { ModuleOutcome } from "./tabNavigation";

export type KeystrokeState = {
  dwellBaseline: number[];
  flightBaseline: number[];
  nKeys: number;
};

export function initKeystrokeState(): KeystrokeState {
  return { dwellBaseline: [], flightBaseline: [], nKeys: 0 };
}

const MIN_KEYS_PER_WINDOW = 4;
const KEYS_FOR_FULL_CONFIDENCE = 6; // ~72 WPM; reaching this in a 1 s window gives full authority
const WARMUP_KEYS = 40;
const CORRECTION_KEYS = new Set(["Backspace", "Delete"]);

function zscore(value: number, baseline: number[]): number {
  if (baseline.length < 3) return 0;
  const m = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((a, b) => a + (b - m) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance);
  return std < 1e-9 ? 0 : (value - m) / std;
}

export function updateKeystroke(
  state: KeystrokeState,
  keys: { key: string; dwell: number; flight: number }[],
): ModuleOutcome {
  const dwells = keys.map((k) => Number(k.dwell)).filter(Number.isFinite);
  const flights = keys.map((k) => Number(k.flight)).filter(Number.isFinite);

  if (dwells.length < MIN_KEYS_PER_WINDOW) {
    return {
      risk: 0,
      confidence: 0,
      status: "inactive",
      detail: { reason: `only ${dwells.length} keystrokes (need ${MIN_KEYS_PER_WINDOW})` },
    };
  }

  const corrections = keys.filter((k) => CORRECTION_KEYS.has(String(k.key))).length;
  const confidence = Math.min(1.0, dwells.length / KEYS_FOR_FULL_CONFIDENCE);

  state.nKeys += dwells.length;
  const errorRatio = corrections / Math.max(keys.length, 1);

  if (state.nKeys < WARMUP_KEYS) {
    state.dwellBaseline.push(...dwells);
    state.flightBaseline.push(...flights);
    return { risk: 0, confidence: 0, status: "warming", detail: { keys_seen: state.nKeys, need: WARMUP_KEYS } };
  }

  const dwellMean = dwells.reduce((a, b) => a + b, 0) / dwells.length;
  const flightMean = flights.length ? flights.reduce((a, b) => a + b, 0) / flights.length : 0;
  const dwellZ = Math.abs(zscore(dwellMean, state.dwellBaseline));
  const flightZ = flights.length ? Math.abs(zscore(flightMean, state.flightBaseline)) : 0;

  const risk = Math.min(
    1.0,
    0.45 * Math.min(dwellZ / 3.0, 1.0) + 0.45 * Math.min(flightZ / 3.0, 1.0) + 0.1 * Math.min(errorRatio * 2.0, 1.0),
  );

  return {
    risk,
    confidence,
    status: "active",
    detail: {
      dwell_zscore: dwellZ,
      flight_zscore: flightZ,
      error_rate_ratio: errorRatio,
      keys_this_window: dwells.length,
    },
  };
}
