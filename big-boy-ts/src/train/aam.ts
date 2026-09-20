/**
 * Additive angular margin softmax (description.md §5.2).
 *
 * Chosen over a pairwise contrastive loss because margin-based classification
 * trains faster, does not depend on a pair-mining strategy, and separates
 * embeddings better at this data scale. The head is discarded after training —
 * only the encoder ships.
 *
 * Implemented as a plain weight matrix plus a loss function rather than a
 * custom `tf.layers.Layer`. A custom layer would have to be registered and
 * serialised on both sides for `model.save()`/`loadLayersModel()` to work; the
 * head never ships, so all that machinery would buy nothing.
 */

import type * as tfTypes from "@tensorflow/tfjs";

export type AamConfig = {
  /** Angular margin `m`. §5.2 starts at 0.2. */
  margin: number;
  /** Logit scale `s`. §5.2 starts at 30. */
  scale: number;
  /**
   * Epochs of plain cosine softmax before the margin starts ramping, and the
   * length of the ramp that follows. §5.2 asks for a warmup "over the first few
   * epochs"; what it does not say, and what this pipeline hit immediately, is
   * that the margin must not start moving until the encoder already has a
   * usable solution.
   */
  warmupEpochs: number;
};

export const DEFAULT_AAM: AamConfig = { margin: 0.2, scale: 30, warmupEpochs: 8 };

/**
 * Margin in force at a given epoch: 0 for the first `warmupEpochs`, then a
 * linear ramp to `margin` over the next `warmupEpochs`.
 *
 * The flat head matters. Ramping from epoch 0 reliably collapses this model:
 * with s = 30 and 96 classes, an untrained encoder finds it far cheaper to send
 * every embedding and every class direction to the same point — which scores a
 * loss of about log(95·e^(s·(1−cos m)) + 1) ≈ 5.2 — than to actually separate
 * identities. Loss then falls while accuracy decays to chance, which looks like
 * progress in the log and is not.
 */
export function marginAt(config: AamConfig, epoch: number): number {
  if (config.warmupEpochs <= 0) return config.margin;
  if (epoch < config.warmupEpochs) return 0;
  const progress = (epoch - config.warmupEpochs + 1) / config.warmupEpochs;
  return config.margin * Math.min(1, progress);
}

/** The classification head's weight matrix: one unit-norm direction per identity. */
export function createHead(
  tf: typeof tfTypes,
  embeddingDim: number,
  classCount: number,
): tfTypes.Variable<tfTypes.Rank.R2> {
  return tf.variable(
    tf.randomNormal([embeddingDim, classCount], 0, 0.01),
    true,
    "aam_head",
  ) as tfTypes.Variable<tfTypes.Rank.R2>;
}

export type AamOutput = {
  /** Scaled, margin-penalised logits — what the loss consumes. */
  logits: tfTypes.Tensor2D;
  /**
   * Plain cosine similarity to every class direction, no margin.
   *
   * Training accuracy must be read from this, not from `logits`: the margin
   * subtracts roughly `s · sin(m)` from the *target* class alone, which at
   * s = 30 is enough to push the correct class out of the argmax on almost
   * every row. Measured on `logits`, a perfectly healthy run reports an
   * accuracy below chance.
   */
  cosine: tfTypes.Tensor2D;
};

/**
 * Cosine logits with the additive angular margin applied to the target class.
 *
 * `cos(θ + m)` is expanded as `cos θ · cos m − sin θ · sin m` rather than going
 * through `acos`, which is both faster and avoids the gradient blowing up as
 * `cos θ → ±1`.
 */
export function aamLogits(
  tf: typeof tfTypes,
  embeddings: tfTypes.Tensor2D,
  head: tfTypes.Variable<tfTypes.Rank.R2>,
  oneHotLabels: tfTypes.Tensor2D,
  margin: number,
  scale: number,
): AamOutput {
  // No `tf.tidy` here on purpose: this runs inside `optimizer.minimize`, and a
  // tidy scope nested in the gradient tape disposes the very intermediates
  // backprop needs. The surrounding minimize scope cleans up instead.
  {
    const normalizedEmbeddings = tf.div(
      embeddings,
      tf.norm(embeddings, "euclidean", 1, true).add(1e-9),
    ) as tfTypes.Tensor2D;
    const normalizedHead = tf.div(
      head,
      tf.norm(head, "euclidean", 0, true).add(1e-9),
    ) as tfTypes.Tensor2D;

    const cosine = tf.matMul(normalizedEmbeddings, normalizedHead) as tfTypes.Tensor2D;

    if (margin <= 0) return { logits: cosine.mul(scale) as tfTypes.Tensor2D, cosine };

    const clipped = cosine.clipByValue(-1 + 1e-7, 1 - 1e-7);
    const sine = tf.sqrt(tf.sub(1, clipped.square()).clipByValue(1e-9, 1));
    const withMargin = clipped.mul(Math.cos(margin)).sub(sine.mul(Math.sin(margin)));

    // Past θ = π − m the rotated angle wraps around and cos(θ + m) starts
    // *increasing* again, which would reward the worst possible embedding.
    // ArcFace's standard guard replaces that region with a monotone linear
    // extension.
    //
    // The selector is read back through `dataSync` and rebuilt as a fresh
    // constant so it never enters the gradient tape: `greater` has no
    // registered gradient in tfjs, and the mask is a constant with respect to
    // the parameters anyway. On the CPU backend the readback is free.
    const threshold = Math.cos(Math.PI - margin);
    const values = clipped.dataSync();
    const mask = new Float32Array(values.length);
    for (let i = 0; i < values.length; i += 1) mask[i] = values[i]! > threshold ? 1 : 0;
    const keep = tf.tensor2d(mask, clipped.shape as [number, number]);

    const fallback = clipped.sub(Math.sin(margin) * margin);
    const safeMargin = keep
      .mul(withMargin)
      .add(tf.sub(1, keep).mul(fallback)) as tfTypes.Tensor2D;

    const merged = oneHotLabels
      .mul(safeMargin)
      .add(tf.sub(1, oneHotLabels).mul(cosine));

    return { logits: merged.mul(scale) as tfTypes.Tensor2D, cosine };
  }
}
