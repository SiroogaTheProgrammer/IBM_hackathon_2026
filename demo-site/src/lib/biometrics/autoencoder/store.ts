/**
 * Model (de)serialisation. tf.js's own save handlers want a filesystem or
 * IndexedDB; we need a plain JSON blob so a profile can live in Redis next to
 * the rest of the session state.
 */

import type * as TF from "@tensorflow/tfjs";
import { loadTf } from "./backend";
import type { UserProfile } from "./types";

export async function serialiseModel(model: TF.LayersModel): Promise<UserProfile["model"]> {
  const { tf } = await loadTf();

  let captured: TF.io.ModelArtifacts | null = null;
  await model.save(
    tf.io.withSaveHandler(async (artifacts) => {
      captured = artifacts;
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
    }),
  );
  const artifacts = captured as TF.io.ModelArtifacts | null;
  if (!artifacts?.weightData) throw new Error("model save produced no weights");

  const weights = artifacts.weightData as ArrayBuffer;
  return {
    topology: artifacts.modelTopology,
    weightSpecs: artifacts.weightSpecs,
    weightDataB64: Buffer.from(weights).toString("base64"),
  };
}

export async function deserialiseModel(saved: UserProfile["model"]): Promise<TF.LayersModel> {
  const { tf } = await loadTf();

  const bytes = Buffer.from(saved.weightDataB64, "base64");
  // Copy out of the Buffer pool - Node Buffers are views into a shared
  // ArrayBuffer, and handing that whole buffer to tf.js would read garbage.
  const weightData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  return tf.loadLayersModel(
    tf.io.fromMemory({
      modelTopology: saved.topology as object,
      weightSpecs: saved.weightSpecs as TF.io.WeightsManifestEntry[],
      weightData,
    }),
  );
}
