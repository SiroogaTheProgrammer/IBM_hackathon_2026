/**
 * TensorFlow.js backend loader.
 *
 * `@tensorflow/tfjs-node` binds the native TensorFlow C library and is roughly
 * an order of magnitude faster than the pure-JS CPU kernels, but it is a
 * native addon: it needs a matching prebuilt binary and will not load on
 * Vercel's serverless runtime. So we try it, and fall back to the portable
 * pure-JS build, which runs anywhere Node does.
 *
 * Resolve once per process and cache - the fallback import is not free, and
 * mixing two tfjs instances in one process corrupts the kernel registry.
 */

import type * as TF from "@tensorflow/tfjs";

export type TfModule = typeof TF;

let cached: Promise<{ tf: TfModule; backend: "tensorflow" | "cpu" }> | null = null;

export function loadTf(): Promise<{ tf: TfModule; backend: "tensorflow" | "cpu" }> {
  if (cached) return cached;

  cached = (async () => {
    if (process.env.BIOMETRICS_TFJS_BACKEND !== "cpu") {
      try {
        const node = (await import("@tensorflow/tfjs-node")) as unknown as TfModule;
        await node.ready();
        return { tf: node, backend: "tensorflow" as const };
      } catch (error) {
        console.warn(
          "[autoencoder] @tensorflow/tfjs-node unavailable, falling back to the " +
            "pure-JS CPU backend (slower):",
          (error as Error).message,
        );
      }
    }

    const tf = (await import("@tensorflow/tfjs")) as unknown as TfModule;
    await tf.setBackend("cpu");
    await tf.ready();
    return { tf, backend: "cpu" as const };
  })();

  return cached;
}
