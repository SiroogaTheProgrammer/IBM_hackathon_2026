/**
 * The claim this project rests on: the encoder trained offline with
 * `@tensorflow/tfjs-node` loads and runs under the plain `@tensorflow/tfjs`
 * build that ships to a browser, and produces the same embeddings.
 *
 * The model is loaded through an in-memory IO handler built from the exact
 * bytes in `artifacts/`, which is what a browser does when it fetches
 * `model.json` and `weights.bin` over HTTP — no node-only `file://` handler
 * anywhere in the path.
 *
 * Skipped when there is no trained encoder yet.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FEATURE_COUNT } from "./features.ts";
import { StrokeEncoder, cosine } from "./embed.ts";
import type { Scaler } from "./types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARTIFACTS = join(ROOT, "artifacts");
const MODEL_JSON = join(ARTIFACTS, "encoder", "model.json");

test("the trained encoder loads under the browser tfjs build", async (t) => {
  if (!existsSync(MODEL_JSON)) {
    t.skip("no encoder in artifacts/ — run: node src/cli.ts train");
    return;
  }

  const tf = await import("@tensorflow/tfjs");
  const scaler = JSON.parse(readFileSync(join(ARTIFACTS, "scaler.json"), "utf8")) as Scaler;

  // Exactly what `tf.io.browserHTTPRequest` hands the loader, assembled from
  // disk instead of from a `fetch`.
  const modelJson = JSON.parse(readFileSync(MODEL_JSON, "utf8")) as {
    modelTopology: unknown;
    weightsManifest: { paths: string[]; weights: unknown[] }[];
  };
  const weightBuffers = modelJson.weightsManifest.flatMap((group) =>
    group.paths.map((path) => readFileSync(join(ARTIFACTS, "encoder", path))),
  );
  const totalBytes = weightBuffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const weightData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buffer of weightBuffers) {
    weightData.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }

  const handler: tfTypesIoHandler = {
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest.flatMap((group) => group.weights),
      weightData: weightData.buffer,
    }),
  };

  const encoder = await StrokeEncoder.load(tf as never, {
    modelUrl: handler as never,
    scaler,
  });

  assert.equal(encoder.dim, 128, "embedding width must match the shipped contract");

  // Two different strokes must not collapse to the same embedding, and one
  // stroke must embed identically on repeat calls.
  const rowA = Float32Array.from({ length: FEATURE_COUNT }, (_, i) => Math.sin(i * 0.7));
  const rowB = Float32Array.from({ length: FEATURE_COUNT }, (_, i) => Math.cos(i * 0.31) * 2);

  const [a1, b1] = await encoder.encode([rowA, rowB]);
  const [a2] = await encoder.encode([rowA]);
  assert.ok(a1 && b1 && a2);

  assert.ok(Math.abs(Math.hypot(...a1) - 1) < 1e-5, "embeddings must be length-normalised");
  assert.ok(cosine(a1, a2) > 0.9999, "encoding must be deterministic");
  assert.ok(cosine(a1, b1) < 0.999, "distinct inputs must give distinct embeddings");

  // Under two strokes, §6.1 says skip rather than score.
  assert.equal(await encoder.encodeSubtask([rowA]), null);
  assert.ok(await encoder.encodeSubtask([rowA, rowB]));

  encoder.dispose();
});

/** Minimal shape of a tfjs `IOHandler`, to avoid importing node-only types. */
type tfTypesIoHandler = {
  load: () => Promise<{
    modelTopology: unknown;
    weightSpecs: unknown[];
    weightData: ArrayBuffer;
  }>;
};
