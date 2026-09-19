/**
 * Per-user autoencoder training, ported from ML_Models/train_pipeline_1.py.
 *
 * The model only ever sees one user's data, so it learns to reconstruct that
 * user's event distribution well and everyone else's badly; the reconstruction
 * error is the impostor signal.
 */

import { loadTf } from "./backend";
import { WINDOW_FEATURE_DIM } from "./features";
import { buildAutoencoder, reconstructionError } from "./model";
import { applyScaler, fitScaler } from "./scaler";
import { serialiseModel } from "./store";
import type { UserProfile } from "./types";

/** Below this the threshold calibration is too noisy to be worth storing. */
export const MIN_TRAIN_WINDOWS = 200;

export interface TrainOptions {
  epochs?: number;
  batchSize?: number;
  /** Fraction of rows held out to calibrate the genuine-error threshold. */
  validationSplit?: number;
  /** Cutoff = genuine mean + this many standard deviations. */
  thresholdSigma?: number;
  /** Refuse to train below this many windows. Defaults to MIN_TRAIN_WINDOWS. */
  minWindows?: number;
  onEpochEnd?: (epoch: number, loss: number) => void;
}

export async function trainUserModel(
  userId: string,
  data: Float32Array,
  rows: number,
  options: TrainOptions = {},
): Promise<UserProfile> {
  const {
    epochs = 120,
    batchSize = 256,
    validationSplit = 0.15,
    thresholdSigma = 3,
    minWindows = MIN_TRAIN_WINDOWS,
  } = options;

  // Windows, not events - a minute of active mousing is roughly 60 of them.
  if (rows < minWindows) {
    throw new Error(
      `not enough mouse data to enrol ${userId}: ${rows} windows, need ${minWindows}`,
    );
  }

  const { tf } = await loadTf();

  // Chronological split: the tail of the recording calibrates the threshold.
  // Holding out a random subset would leak, since consecutive mouse events are
  // near-duplicates of each other.
  const trainRows = Math.floor(rows * (1 - validationSplit));
  const valRows = rows - trainRows;

  const scaler = fitScaler(data.subarray(0, trainRows * WINDOW_FEATURE_DIM), trainRows, WINDOW_FEATURE_DIM);
  applyScaler(data, rows, WINDOW_FEATURE_DIM, scaler);

  const model = buildAutoencoder(tf);

  const xs = tf.tensor2d(data.subarray(0, trainRows * WINDOW_FEATURE_DIM), [trainRows, WINDOW_FEATURE_DIM]);
  try {
    await model.fit(xs, xs, {
      epochs,
      batchSize,
      shuffle: true,
      verbose: 0,
      callbacks: options.onEpochEnd
        ? {
            onEpochEnd: (epoch, logs) => {
              options.onEpochEnd!(epoch, (logs?.loss as number) ?? NaN);
            },
          }
        : undefined,
    });
  } finally {
    xs.dispose();
  }

  // Calibrate on the held-out genuine tail.
  const { perRow } = reconstructionError(
    tf,
    model,
    data.subarray(trainRows * WINDOW_FEATURE_DIM),
    valRows,
  );

  let mean = 0;
  for (let i = 0; i < valRows; i++) mean += perRow[i];
  mean /= valRows;
  let variance = 0;
  for (let i = 0; i < valRows; i++) variance += (perRow[i] - mean) ** 2;
  const std = Math.sqrt(variance / valRows);

  const profile: UserProfile = {
    userId,
    model: await serialiseModel(model),
    scaler,
    threshold: { mean, std, cutoff: mean + thresholdSigma * std },
    trainedAt: Date.now(),
    trainRows,
    epochs,
  };

  model.dispose();
  return profile;
}
