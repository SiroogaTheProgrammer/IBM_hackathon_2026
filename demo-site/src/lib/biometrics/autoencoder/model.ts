/**
 * The autoencoder from ML_Models/train_pipeline_1.py, as a tf.js model.
 *
 * The layer widths are scaled up from the original 32/16/8: that stack was
 * sized for a 13-dimensional per-event vector, and an 8-unit bottleneck on
 * 26 richer window features throws away too much to separate users.
 */

import type * as TF from "@tensorflow/tfjs";
import { WINDOW_FEATURE_DIM } from "./features";

export function buildAutoencoder(tf: typeof TF, inputDim = WINDOW_FEATURE_DIM): TF.LayersModel {
  const model = tf.sequential();
  // Encoder: inputDim -> 64 -> 32 -> 12 (bottleneck, linear as in the PyTorch version)
  model.add(tf.layers.dense({ inputShape: [inputDim], units: 64, activation: "relu" }));
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 12 }));
  // Decoder: 12 -> 32 -> 64 -> inputDim
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 64, activation: "relu" }));
  model.add(tf.layers.dense({ units: inputDim }));

  model.compile({ optimizer: tf.train.adam(0.001), loss: "meanSquaredError" });
  return model;
}

/**
 * Mean per-row reconstruction MSE, computed in chunks so a multi-hundred-
 * thousand-row session never materialises as one giant tensor.
 */
export function reconstructionError(
  tf: typeof TF,
  model: TF.LayersModel,
  data: Float32Array,
  rows: number,
  inputDim = WINDOW_FEATURE_DIM,
  chunkRows = 65536,
): { mean: number; perRow: Float32Array } {
  const perRow = new Float32Array(rows);
  let total = 0;

  for (let start = 0; start < rows; start += chunkRows) {
    const n = Math.min(chunkRows, rows - start);
    const slice = data.subarray(start * inputDim, (start + n) * inputDim);
    const mse = tf.tidy(() => {
      const x = tf.tensor2d(slice, [n, inputDim]);
      const recon = model.predict(x) as TF.Tensor2D;
      return tf.mean(tf.square(tf.sub(recon, x)), 1).dataSync() as Float32Array;
    });
    perRow.set(mse, start);
    for (let i = 0; i < n; i++) total += mse[i];
  }

  return { mean: total / rows, perRow };
}
