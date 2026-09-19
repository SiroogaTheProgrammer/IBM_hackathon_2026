/**
 * `compute_error()` from ML_Models/identity_detection_full.py: run a candidate
 * session's rows through an enrolled user's autoencoder and report how badly
 * they reconstruct.
 */

import { loadTf } from "../autoencoder/backend";
import { reconstructionError } from "../autoencoder/model";
import { deserialiseModel } from "../autoencoder/store";
import { ROW_DIM } from "./features";
import { applyStandardScaler } from "./scaler";
import type { LittleBoyProfile } from "./types";

export interface LittleBoyScore {
  /** Mean per-row reconstruction MSE. */
  error: number;
  /** (error - genuineMean) / genuineStd. Higher = less like the enrolled user. */
  z: number;
  /** Fraction of individual rows whose own error exceeds the cutoff. */
  anomalousRowFraction: number;
  isImpostor: boolean;
  rows: number;
}

/** Standardises `data` in place with the profile's scaler. */
export async function rowErrors(
  profile: LittleBoyProfile,
  data: Float32Array,
  rows: number,
): Promise<{ mean: number; perRow: Float32Array }> {
  const { tf } = await loadTf();
  const model = await deserialiseModel(profile.model);
  try {
    applyStandardScaler(data, rows, ROW_DIM, profile.scaler);
    return reconstructionError(tf, model, data, rows, ROW_DIM);
  } finally {
    model.dispose();
  }
}

export async function scoreLittleBoy(
  profile: LittleBoyProfile,
  data: Float32Array,
  rows: number,
): Promise<LittleBoyScore> {
  const { mean, perRow } = await rowErrors(profile, data, rows);

  // Row-level cutoff for the row-level statistic; the block-level cutoff below
  // is the one the aggregated error is compared against.
  let anomalous = 0;
  for (let i = 0; i < rows; i++) if (perRow[i] > profile.threshold.rowCutoff) anomalous++;

  const { mean: gMean, std: gStd, cutoff } = profile.threshold;

  return {
    error: mean,
    z: gStd > 0 ? (mean - gMean) / gStd : 0,
    anomalousRowFraction: anomalous / rows,
    isImpostor: mean > cutoff,
    rows,
  };
}
