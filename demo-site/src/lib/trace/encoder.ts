/**
 * Loading the trained stroke encoder and the §6 backend into the browser.
 *
 * **The privacy property in description.md §1 is real here and worth keeping in
 * the pitch:** the encoder runs client-side. Raw cursor trajectories never
 * leave the device — the only thing a run produces is a set of 128-d
 * embeddings and, from them, scalar scores. Nothing in this file talks to a
 * server. (Data-collection mode is the one deliberate exception, is
 * localhost-only, and is a separate research instrument.)
 *
 * Everything is fetched lazily on the first run, so a visitor who never starts
 * one never downloads the ~660 KB of model, weights and cohort.
 */

import { StrokeEncoder, assertScalerMatches } from "@encoder/index";
import type { CohortIndex, LlrModel, Scaler } from "@encoder/index";

const BASE = "/models/stroke-encoder";

/** The global cohort bucket — see `provenance.limitations` in backend.json. */
export const GLOBAL_SUBTASK = "*";

/**
 * The shipped §6 parameters, as written by `big-boy-ts`'s eval command.
 *
 * `provenance` is not decoration. These distributions are fitted on held-out
 * *SapiMouse* identities, which is not what §6.4 asks for, and the UI shows the
 * caveat rather than presenting them as calibrated numbers.
 */
export type BackendConfig = {
  featureVersion: string;
  dim: number;
  cohort: {
    file: string;
    count: number;
    /**
     * Where each sub-task's bank sits in the flat buffer. §6.2 wants one bank
     * per sub-task id; `"*"` is the whole buffer, used when a sub-task's own
     * bank is too thin for AS-norm to engage.
     */
    index?: Record<string, { start: number; count: number }>;
    subtaskIds: string[];
    topN: number;
  };
  /**
   * `null` when the genuine score distribution has not been measured. §6.4
   * item 1 needs two runs from one participant; until that exists there is
   * nothing to turn a similarity into a likelihood ratio, and the run reports
   * no decision rather than a verdict from half a calibration.
   */
  llr: LlrModel | null;
  /**
   * True when the genuine half of the LLR was assumed rather than measured —
   * see `big-boy-ts/src/calibrate/operating.ts`. The UI says so on screen.
   */
  assumedGenuine?: boolean;
  /** Simulated error rates under that assumption. Not measurements. */
  simulated?: {
    falseLockoutRate: number;
    impostorDetectionRate: number;
    medianSubtasksToDetection: number | null;
    verifiedRate: number;
  } | null;
  thresholds: { upper: number; lower: number } | null;
  accumulator: { leak: number };
  sprt: { alpha: number; beta: number };
  provenance: {
    source: string;
    limitations: string[];
    [key: string]: unknown;
  };
};

export type LoadedEncoder = {
  encoder: StrokeEncoder;
  /** Absent when `backend.json` was not exported — embeddings still work. */
  backend: BackendConfig | null;
  cohort: CohortIndex;
};

let pending: Promise<LoadedEncoder> | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Split a flat Float32 buffer of `count × dim` into embeddings.
 *
 * The cohort ships as raw binary rather than JSON: 439 × 128 floats is 224 KB
 * as a `.bin` and roughly a megabyte as decimal text, and §6.2 budgets "a few
 * hundred KB" for it.
 */
function unpackCohort(buffer: ArrayBuffer, dim: number): Float32Array[] {
  const flat = new Float32Array(buffer);
  const count = Math.floor(flat.length / dim);
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = flat.subarray(i * dim, (i + 1) * dim);
  }
  return out;
}

async function loadBackend(dim: number): Promise<{
  backend: BackendConfig | null;
  cohort: CohortIndex;
}> {
  const cohort: CohortIndex = new Map();

  let backend: BackendConfig;
  try {
    backend = await fetchJson<BackendConfig>(`${BASE}/backend.json`);
  } catch {
    // The encoder alone still produces embeddings; without a fitted LLR model
    // the run reports "no decision" rather than inventing one.
    return { backend: null, cohort };
  }

  if (backend.dim !== dim) {
    throw new Error(
      `backend.json says ${backend.dim}-d embeddings, encoder produces ${dim}-d`,
    );
  }

  try {
    const response = await fetch(`${BASE}/${backend.cohort.file}`);
    if (response.ok) {
      const embeddings = unpackCohort(await response.arrayBuffer(), backend.dim);
      const index = backend.cohort.index;

      if (index) {
        // Demo-calibrated: a real bank per sub-task id, plus "*" over all of it.
        for (const [id, slice] of Object.entries(index)) {
          cohort.set(id, embeddings.slice(slice.start, slice.start + slice.count));
        }
      } else {
        // Older SapiMouse export: one undifferentiated bank under every id.
        for (const id of backend.cohort.subtaskIds) cohort.set(id, embeddings);
      }
    }
  } catch {
    /* AS-norm degrades to the raw cosine; asNorm() handles an empty bank. */
  }

  return { backend, cohort };
}

/** Load once per page, and hand the same instance to every later run. */
export function loadEncoder(): Promise<LoadedEncoder> {
  pending ??= (async () => {
    const [tf, scaler] = await Promise.all([
      import("@tensorflow/tfjs"),
      fetchJson<Scaler>(`${BASE}/scaler.json`),
    ]);

    // Throws loudly if the shipped scaler and this build disagree on the
    // feature set, rather than silently scoring garbage through a stale file.
    assertScalerMatches(scaler);

    const encoder = await StrokeEncoder.load(tf as never, {
      modelUrl: `${BASE}/model.json`,
      scaler,
    });

    const { backend, cohort } = await loadBackend(encoder.dim);
    return { encoder, backend, cohort };
  })().catch((error: unknown) => {
    // Let the next run retry rather than caching the failure forever.
    pending = null;
    throw error;
  });

  return pending;
}
