/**
 * Running the trained encoder (description.md §5.1).
 *
 * The TensorFlow namespace is injected rather than imported so this file works
 * unchanged against `@tensorflow/tfjs-node` offline and `@tensorflow/tfjs` (or
 * `tfjs/wasm`) in the browser, without dragging a node build into a bundle.
 *
 * The L2 normalisation and the mean-pooling deliberately live here in plain
 * TypeScript rather than inside the saved graph: a `Lambda` layer does not
 * survive `model.save()` round-trips in tfjs, and keeping the last two steps in
 * readable code makes the embedding contract inspectable.
 */

import { applyScaler, assertScalerMatches } from "./standardize.ts";
import type { Scaler } from "./types.ts";

/** The slice of the TensorFlow.js API this file needs. */
export type TfNamespace = {
  loadLayersModel: (path: unknown) => Promise<{
    predict: (inputs: unknown) => { data: () => Promise<Float32Array | Int32Array | Uint8Array>; dispose: () => void };
    dispose: () => void;
  }>;
  tensor2d: (values: Float32Array | number[][], shape?: [number, number]) => {
    dispose: () => void;
  };
};

export type EncoderBundle = {
  /** Where `model.json` lives. A URL in the browser, `file://…` under node. */
  modelUrl: string;
  scaler: Scaler;
};

/** L2-normalise a vector in place and return it (§5.1: length-normalized). */
export function l2normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) sum += vector[i]! * vector[i]!;
  const norm = Math.sqrt(sum);
  if (norm > 1e-9) {
    for (let i = 0; i < vector.length; i += 1) vector[i]! /= norm;
  }
  return vector;
}

/** Cosine similarity between two length-normalised embeddings. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

/**
 * Average-pool per-stroke embeddings into one embedding, then renormalise.
 *
 * §5.1 chooses pooled averages over jointly encoding a whole window: they stay
 * stable when a sub-task turns out to be short, and they compose with the
 * evidence accumulator instead of fighting it.
 */
export function poolEmbeddings(embeddings: Float32Array[]): Float32Array | null {
  if (embeddings.length === 0) return null;
  const dim = embeddings[0]!.length;
  const out = new Float32Array(dim);
  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i += 1) out[i]! += embedding[i]!;
  }
  for (let i = 0; i < dim; i += 1) out[i]! /= embeddings.length;
  return l2normalize(out);
}

/** Loads the shipped encoder and turns stroke features into embeddings. */
export class StrokeEncoder {
  private readonly tf: TfNamespace;
  private readonly model: Awaited<ReturnType<TfNamespace["loadLayersModel"]>>;
  readonly scaler: Scaler;
  readonly dim: number;

  private constructor(
    tf: TfNamespace,
    model: Awaited<ReturnType<TfNamespace["loadLayersModel"]>>,
    scaler: Scaler,
    dim: number,
  ) {
    this.tf = tf;
    this.model = model;
    this.scaler = scaler;
    this.dim = dim;
  }

  static async load(tf: TfNamespace, bundle: EncoderBundle): Promise<StrokeEncoder> {
    assertScalerMatches(bundle.scaler);
    const model = await tf.loadLayersModel(bundle.modelUrl);
    // One dummy forward pass fixes the output width and warms the kernels, so
    // the first real sub-task is not also the first JIT compile.
    const probe = tf.tensor2d(
      new Float32Array(bundle.scaler.mean.length),
      [1, bundle.scaler.mean.length],
    );
    const out = model.predict(probe);
    const values = await out.data();
    probe.dispose();
    out.dispose();
    return new StrokeEncoder(tf, model, bundle.scaler, values.length);
  }

  /**
   * Encode raw (unstandardised) stroke feature vectors. Standardisation happens
   * here so callers cannot forget it.
   */
  async encode(rows: Float32Array[]): Promise<Float32Array[]> {
    if (rows.length === 0) return [];
    const width = this.scaler.mean.length;
    const flat = new Float32Array(rows.length * width);
    rows.forEach((row, index) => {
      flat.set(applyScaler(row, this.scaler), index * width);
    });

    const input = this.tf.tensor2d(flat, [rows.length, width]);
    const output = this.model.predict(input);
    const values = Float32Array.from(await output.data());
    input.dispose();
    output.dispose();

    const out: Float32Array[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i += 1) {
      out[i] = l2normalize(values.slice(i * this.dim, (i + 1) * this.dim));
    }
    return out;
  }

  /** Encode a sub-task's strokes straight to its pooled embedding. */
  async encodeSubtask(rows: Float32Array[]): Promise<Float32Array | null> {
    // §6.1: fewer than two strokes is skipped rather than scored noisily.
    if (rows.length < 2) return null;
    return poolEmbeddings(await this.encode(rows));
  }

  dispose(): void {
    this.model.dispose();
  }
}
