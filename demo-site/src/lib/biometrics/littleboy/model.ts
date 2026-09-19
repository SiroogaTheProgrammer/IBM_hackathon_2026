/**
 * `InteractionAutoencoder` from ML_Models/train_pipeline_1.py, as a tf.js model.
 *
 * Layer widths are the Python ones verbatim - 32 / 16 / 8 / 16 / 32 - not the
 * widened stack in `autoencoder/model.ts`. That module scaled them up because
 * it feeds 26 information-dense window features through the bottleneck; here
 * the input is the original 13-dimensional per-event vector the 8-unit
 * bottleneck was sized for.
 */

import type * as TF from "@tensorflow/tfjs";
import { ROW_DIM } from "./features";

export function buildLittleBoy(tf: typeof TF, inputDim = ROW_DIM): TF.LayersModel {
  const model = tf.sequential();
  // Encoder: inputDim -> 32 -> 16 -> 8. The bottleneck is linear, as in the
  // PyTorch version - its nn.Sequential ends on nn.Linear(16, 8) with no ReLU.
  model.add(tf.layers.dense({ inputShape: [inputDim], units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: 8 }));
  // Decoder: 8 -> 16 -> 32 -> inputDim
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: 32, activation: "relu" }));
  model.add(tf.layers.dense({ units: inputDim }));

  // optim.Adam(model.parameters(), lr=0.001) + nn.MSELoss()
  model.compile({ optimizer: tf.train.adam(0.001), loss: "meanSquaredError" });
  return model;
}
