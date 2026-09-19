/**
 * The trained window encoder, evaluated with TensorFlow.js.
 *
 *   (N strokes, 60 features)
 *     -> per-stroke MLP  [Linear, LayerNorm, GELU] x 2
 *     -> pool over strokes: attention || mean || std   (768-d)
 *     -> head [Linear, LayerNorm, GELU, Linear] -> 64-d, L2-normalised
 *
 * Pooling is permutation-invariant on purpose: stroke order inside a window is
 * close to arbitrary, and an order-sensitive encoder mostly learns
 * session-specific sequencing, which does not transfer to a new session.
 *
 * Dropout is training-only and therefore absent here, which is why this matches
 * the Python model in eval mode exactly.
 */
import * as tf from "@tensorflow/tfjs";

type Packed = { shape: number[]; data: string };
type ModelJson = {
  n_features: number;
  n_strokes: number;
  stride: number;
  d_embed: number;
  weights: Record<string, Packed>;
};

function unpack(p: Packed): tf.Tensor {
  const buf = Buffer.from(p.data, "base64");
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return tf.tensor(Array.from(f32), p.shape as number[]);
}

/** PyTorch nn.Linear stores (out, in); tf.matmul wants (in, out). */
function linear(x: tf.Tensor2D, w: tf.Tensor, b: tf.Tensor): tf.Tensor2D {
  return tf.add(tf.matMul(x, tf.transpose(w as tf.Tensor2D)), b) as tf.Tensor2D;
}

/** nn.LayerNorm over the last axis, eps 1e-5 as in PyTorch. */
function layerNorm(x: tf.Tensor2D, g: tf.Tensor, b: tf.Tensor): tf.Tensor2D {
  const { mean, variance } = tf.moments(x, -1, true);
  const xn = tf.div(tf.sub(x, mean), tf.sqrt(tf.add(variance, 1e-5)));
  return tf.add(tf.mul(xn, g), b) as tf.Tensor2D;
}

/** Exact GELU (PyTorch default), not the tanh approximation. */
function gelu(x: tf.Tensor2D): tf.Tensor2D {
  return tf.tidy(() => {
    const cdf = tf.mul(0.5, tf.add(1, tf.erf(tf.div(x, Math.SQRT2))));
    return tf.mul(x, cdf) as tf.Tensor2D;
  });
}

export class WindowEncoder {
  private w: Record<string, tf.Tensor> = {};
  readonly nFeatures: number;
  readonly nStrokes: number;
  readonly stride: number;
  readonly dEmbed: number;

  constructor(model: ModelJson) {
    this.nFeatures = model.n_features;
    this.nStrokes = model.n_strokes;
    this.stride = model.stride;
    this.dEmbed = model.d_embed;
    for (const [k, v] of Object.entries(model.weights)) this.w[k] = unpack(v);
  }

  dispose() {
    Object.values(this.w).forEach((t) => t.dispose());
    this.w = {};
  }

  /** windows: (B, N, F) -> (B, dEmbed), L2-normalised. */
  embed(windows: Float32Array[][]): Float32Array[] {
    const B = windows.length;
    if (B === 0) return [];
    const N = this.nStrokes, F = this.nFeatures;
    const flat = new Float32Array(B * N * F);
    windows.forEach((win, bi) =>
      win.forEach((row, si) => flat.set(row, (bi * N + si) * F)));

    const out = tf.tidy(() => {
      // per-stroke MLP: fold the stroke axis into the batch
      let h = tf.tensor2d(Array.from(flat), [B * N, F]);
      h = gelu(layerNorm(linear(h, this.w["set.stroke.0.weight"], this.w["set.stroke.0.bias"]),
                         this.w["set.stroke.1.weight"], this.w["set.stroke.1.bias"]));
      h = gelu(layerNorm(linear(h, this.w["set.stroke.4.weight"], this.w["set.stroke.4.bias"]),
                         this.w["set.stroke.5.weight"], this.w["set.stroke.5.bias"]));
      const D = h.shape[1];
      const h3 = tf.reshape(h, [B, N, D]) as tf.Tensor3D;

      // attention over the stroke axis
      const sc1 = tf.tanh(linear(h, this.w["set.attn.score.0.weight"],
                                 this.w["set.attn.score.0.bias"]));
      const sc2 = linear(sc1, this.w["set.attn.score.2.weight"],
                         this.w["set.attn.score.2.bias"]);
      const wAttn = tf.softmax(tf.reshape(sc2, [B, N]), 1);
      const attn = tf.sum(tf.mul(h3, tf.expandDims(wAttn, -1)), 1) as tf.Tensor2D;

      const mu = tf.mean(h3, 1) as tf.Tensor2D;
      // torch .std(unbiased=False) == population std
      const sd = tf.sqrt(tf.mean(tf.square(tf.sub(h3, tf.expandDims(mu, 1))), 1)) as tf.Tensor2D;

      let z = tf.concat([attn, mu, sd], 1) as tf.Tensor2D;
      z = gelu(layerNorm(linear(z, this.w["set.head.0.weight"], this.w["set.head.0.bias"]),
                         this.w["set.head.1.weight"], this.w["set.head.1.bias"]));
      z = linear(z, this.w["set.head.4.weight"], this.w["set.head.4.bias"]);
      return tf.div(z, tf.norm(z, "euclidean", 1, true)) as tf.Tensor2D;
    });

    const data = out.dataSync() as Float32Array;
    out.dispose();
    const res: Float32Array[] = [];
    for (let i = 0; i < B; i++) res.push(data.slice(i * this.dEmbed, (i + 1) * this.dEmbed));
    return res;
  }
}
