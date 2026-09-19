/**
 * `train_autoencoder()` from ML_Models/train_pipeline_1.py.
 *
 * The model only ever sees one user's events, so it learns to reconstruct that
 * user's event distribution well and everyone else's badly; the mean
 * reconstruction error is the impostor signal.
 *
 * One addition over the Python version. `identity_detection_full.py` decides
 * whether a session is an impostor by comparing its error against the *genuine*
 * user's error on the same day - a number a live check does not have. So
 * training also holds out a chronological tail of the user's own rows and
 * stores an absolute cutoff (`mean + k*sigma`) calibrated on it. The split is
 * chronological rather than random because consecutive mouse events are near
 * duplicates of each other, and a random split would leak the calibration rows
 * into training and produce an over-tight cutoff.
 */

import { loadTf } from "../autoencoder/backend";
import { reconstructionError } from "../autoencoder/model";
import { serialiseModel } from "../autoencoder/store";
import { FEATURE_COLS, ROW_DIM } from "./features";
import { buildLittleBoy } from "./model";
import { applyStandardScaler, fitStandardScaler } from "./scaler";
import type { LittleBoyProfile } from "./types";

/** Below this the threshold calibration is too noisy to be worth storing. */
export const MIN_TRAIN_ROWS = 500;

export interface TrainOptions {
  /** train_pipeline_1.py's default. */
  epochs?: number;
  /** train_pipeline_1.py's default. */
  batchSize?: number;
  /** Fraction of rows held out to calibrate the genuine-error threshold. */
  validationSplit?: number;
  /** Cutoff = genuine mean + this many standard deviations. */
  thresholdSigma?: number;
  /** Refuse to train below this many rows. Defaults to MIN_TRAIN_ROWS. */
  minRows?: number;
  /**
   * Rows per calibration block - i.e. how many events a scoring call will
   * typically average over. Live enrolment passes the capture's own observed
   * events-per-tick; offline evaluation leaves it at 1, which reproduces the
   * Python pipeline's per-row statistics.
   */
  blockRows?: number;
  onEpochEnd?: (epoch: number, loss: number) => void;
}

/**
 * Mean and standard deviation of the per-block mean error, where a block is
 * `blockRows` consecutive rows - the same aggregation a live tick performs.
 *
 * Blocks overlap by half their length. Non-overlapping blocks of ~50 rows leave
 * only a dozen samples from a held-out tail this size, which is too few for a
 * usable sigma; the halved hop roughly doubles the count. The samples are then
 * correlated, so this is a variance-reduced but slightly optimistic estimate -
 * acceptable for a display statistic, and still far better calibrated than
 * comparing a 50-row mean against a single-row spread.
 */
function blockStats(
  perRow: Float32Array,
  rows: number,
  requested: number,
): { mean: number; std: number; blockRows: number } {
  // Always leave room for at least 4 blocks, however large the requested size.
  const blockRows = Math.max(1, Math.min(Math.round(requested), Math.floor(rows / 4)));
  if (blockRows <= 1) {
    let mean = 0;
    for (let i = 0; i < rows; i++) mean += perRow[i];
    mean /= rows;
    let variance = 0;
    for (let i = 0; i < rows; i++) variance += (perRow[i] - mean) ** 2;
    return { mean, std: Math.sqrt(variance / rows), blockRows: 1 };
  }

  const hop = Math.max(1, Math.floor(blockRows / 2));
  const means: number[] = [];
  for (let start = 0; start + blockRows <= rows; start += hop) {
    let sum = 0;
    for (let i = start; i < start + blockRows; i++) sum += perRow[i];
    means.push(sum / blockRows);
  }

  let mean = 0;
  for (const m of means) mean += m;
  mean /= means.length;
  let variance = 0;
  for (const m of means) variance += (m - mean) ** 2;
  return { mean, std: Math.sqrt(variance / means.length), blockRows };
}

/**
 * Fit one user's autoencoder. `data` is consumed in place - it is standardised
 * rather than copied, since a couple of minutes of capture is tens of thousands
 * of rows and the caller has no use for the unscaled matrix afterwards.
 */
export async function trainLittleBoy(
  userId: string,
  data: Float32Array,
  rows: number,
  options: TrainOptions = {},
): Promise<LittleBoyProfile> {
  const {
    epochs = 50,
    batchSize = 32,
    validationSplit = 0.15,
    thresholdSigma = 3,
    minRows = MIN_TRAIN_ROWS,
    blockRows = 1,
  } = options;

  if (rows < minRows) {
    throw new Error(
      `not enough mouse activity to train little_boy for ${userId}: ` +
        `${rows} events, need ${minRows}`,
    );
  }

  const { tf } = await loadTf();

  const trainRows = Math.floor(rows * (1 - validationSplit));
  const valRows = rows - trainRows;

  // Fit on the training rows only, then transform everything - fitting on the
  // full matrix would let the calibration tail influence its own scaling.
  const scaler = fitStandardScaler(data.subarray(0, trainRows * ROW_DIM), trainRows, ROW_DIM);
  applyStandardScaler(data, rows, ROW_DIM, scaler);

  const model = buildLittleBoy(tf);

  const xs = tf.tensor2d(data.subarray(0, trainRows * ROW_DIM), [trainRows, ROW_DIM]);
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

  const { perRow } = reconstructionError(
    tf,
    model,
    data.subarray(trainRows * ROW_DIM),
    valRows,
    ROW_DIM,
  );

  // Per-row statistics, for the anomalous-row diagnostic.
  let rowMean = 0;
  for (let i = 0; i < valRows; i++) rowMean += perRow[i];
  rowMean /= valRows;
  let rowVar = 0;
  for (let i = 0; i < valRows; i++) rowVar += (perRow[i] - rowMean) ** 2;
  const rowStd = Math.sqrt(rowVar / valRows);

  const { mean, std, blockRows: block } = blockStats(perRow, valRows, blockRows);

  const profile: LittleBoyProfile = {
    userId,
    model: await serialiseModel(model),
    scaler,
    featureCols: FEATURE_COLS,
    threshold: {
      mean,
      std,
      cutoff: mean + thresholdSigma * std,
      rowCutoff: rowMean + thresholdSigma * rowStd,
      blockRows: block,
    },
    trainedAt: Date.now(),
    trainRows,
    epochs,
  };

  model.dispose();
  return profile;
}
