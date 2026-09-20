/**
 * TypeScript port of `SiameseEncoder.forward` from
 * `behavioral_biometrics_nn/encoder.py`:
 *
 *     Input(32) -> Dense(64, ReLU) -> Dense(128, ReLU) -> Dense(128, Linear) -> L2 norm
 *
 * Weights are exported once via `export_web_model.py` into
 * `model/mouseEncoder.json` (three Linear layers' weight/bias matrices) -
 * small enough to bundle directly, avoiding a PyTorch runtime dependency in
 * the Vercel function.
 */

import mouseEncoderJson from "./model/mouseEncoder.json";
import mouseEncoderBigJson from "./model/mouseEncoderBig.json";

type Layer = { w: number[][]; b: number[] };
type EncoderData = { input_dim: number; embedding_dim: number; layers: Layer[] };

const model = mouseEncoderJson as EncoderData;
// Second, separately-selectable variant: same architecture, retrained on the
// combined Balabit + Bogazici dataset (see train_base_model.py's
// `train_combined`). Exported via `python export_web_model.py --suffix Big`.
const modelBig = mouseEncoderBigJson as EncoderData;

export const INPUT_DIM = model.input_dim;
export const EMBEDDING_DIM = model.embedding_dim;

function linear(x: number[], layer: Layer): number[] {
  return layer.w.map((row, i) => {
    let s = layer.b[i];
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    return s;
  });
}

function relu(x: number[]): number[] {
  return x.map((v) => (v > 0 ? v : 0));
}

function runEncoder(m: EncoderData, scaledFeatures: number[]): number[] {
  let h = relu(linear(scaledFeatures, m.layers[0]));
  h = relu(linear(h, m.layers[1]));
  h = linear(h, m.layers[2]);
  const norm = Math.sqrt(h.reduce((a, v) => a + v * v, 0));
  return norm > 0 ? h.map((v) => v / norm) : h;
}

/** Run the frozen encoder forward pass on an already-scaled 32-D feature
 * vector, returning an L2-normalised embedding. */
export function embed(scaledFeatures: number[]): number[] {
  return runEncoder(model, scaledFeatures);
}

/** Same forward pass, using the big/combined-dataset model's weights. */
export function embedBig(scaledFeatures: number[]): number[] {
  return runEncoder(modelBig, scaledFeatures);
}
