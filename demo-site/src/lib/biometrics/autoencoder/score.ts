/** Score a candidate session against an enrolled user's autoencoder. */

import { loadTf } from "./backend";
import { WINDOW_FEATURE_DIM } from "./features";
import { reconstructionError } from "./model";
import { applyScaler } from "./scaler";
import { deserialiseModel } from "./store";
import type { ScoreResult, UserProfile } from "./types";

/**
 * Per-window reconstruction errors, standardising `data` in place.
 * Exposed separately so evaluation can work on the raw score distribution
 * rather than a single aggregate.
 */
export async function windowErrors(
  profile: UserProfile,
  data: Float32Array,
  rows: number,
): Promise<{ mean: number; perWindow: Float32Array }> {
  const { tf } = await loadTf();
  const model = await deserialiseModel(profile.model);
  try {
    applyScaler(data, rows, WINDOW_FEATURE_DIM, profile.scaler);
    const { mean, perRow } = reconstructionError(tf, model, data, rows);
    return { mean, perWindow: perRow };
  } finally {
    model.dispose();
  }
}

export async function scoreSession(
  profile: UserProfile,
  data: Float32Array,
  rows: number,
): Promise<ScoreResult> {
  const { mean, perWindow: perRow } = await windowErrors(profile, data, rows);

  let anomalous = 0;
  for (let i = 0; i < rows; i++) if (perRow[i] > profile.threshold.cutoff) anomalous++;

  const { mean: gMean, std: gStd } = profile.threshold;
  const z = gStd > 0 ? (mean - gMean) / gStd : 0;

  return {
    userId: profile.userId,
    error: mean,
    z,
    // The session-level mean is dominated by a handful of huge-error windows,
    // so the fraction of anomalous windows is the more stable decision variable.
    anomalousRowFraction: anomalous / rows,
    isImpostor: mean > profile.threshold.cutoff,
    rows,
  };
}
