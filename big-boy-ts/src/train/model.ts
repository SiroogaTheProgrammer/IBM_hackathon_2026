/**
 * The encoder (description.md §5.1).
 *
 *   stroke features (34-d, standardized)
 *           │
 *      256 → 256 → 128   (BN + ReLU)
 *           │
 *      128-d embedding
 *
 * The L2 normalisation of §5.1 is applied *outside* the saved graph, in
 * `shared/embed.ts`. Two reasons: a `Lambda`-style layer does not survive a
 * tfjs `save()` round-trip, and keeping the last step in plain TypeScript means
 * the browser and the offline harness provably normalise the same way.
 */

import type * as tfTypes from "@tensorflow/tfjs";

export type EncoderConfig = {
  inputDim: number;
  hidden: number[];
  embeddingDim: number;
  dropout: number;
};

export const DEFAULT_ENCODER: Omit<EncoderConfig, "inputDim"> = {
  hidden: [256, 256],
  embeddingDim: 128,
  dropout: 0.2,
};

export function buildEncoder(
  tf: typeof tfTypes,
  config: EncoderConfig,
): tfTypes.Sequential {
  const model = tf.sequential();

  config.hidden.forEach((units, index) => {
    model.add(
      tf.layers.dense({
        units,
        useBias: false, // the following BatchNorm supplies the shift
        inputShape: index === 0 ? [config.inputDim] : undefined,
        kernelInitializer: "heNormal",
        name: `enc_dense_${index}`,
      }),
    );
    model.add(tf.layers.batchNormalization({ name: `enc_bn_${index}` }));
    model.add(tf.layers.reLU({ name: `enc_relu_${index}` }));
    if (config.dropout > 0) {
      model.add(tf.layers.dropout({ rate: config.dropout, name: `enc_drop_${index}` }));
    }
  });

  // Linear projection: the embedding is normalised afterwards, so a non-linearity
  // here would only fold the sphere onto itself.
  model.add(
    tf.layers.dense({
      units: config.embeddingDim,
      kernelInitializer: "glorotNormal",
      name: "enc_embedding",
    }),
  );

  return model;
}
