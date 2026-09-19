/**
 * The live per-session state machine for the `little_boy` engine.
 *
 *   warm-up   featurise every tick's events and accumulate the rows (~90 s)
 *   fit       standardise, train, calibrate a cutoff on a held-out tail
 *   active    score each incoming tick by mean reconstruction error
 *
 * Structurally this mirrors `autoencoder/liveEngine.ts`, with two differences
 * that follow from the per-event representation:
 *
 * 1. Warm-up runs 90 ticks rather than 60. The window model gets one usable
 *    training row per second; this one gets one per *event*, so a longer
 *    capture is cheap in rows and the extra 30 s buys behavioural variety
 *    (some scrolling, some clicking) rather than just more of the same.
 * 2. The capture is stored as featurised rows, not raw events. A minute and a
 *    half of mousing is a few thousand events, and `{"t":...,"x":...}` objects
 *    cost roughly twice what the packed Float32 rows do in a Redis document
 *    that is read and written on every tick.
 */

import { ADDON_CONFIG } from "../config";
import { sigmoid } from "../math";
import { getRedis } from "../redis";
import { smoothRisk } from "../riskModel";
import type { ModuleResult, MouseEvent2D } from "../types";
import { eventsToRows, ROW_DIM } from "./features";
import { rowErrors } from "./score";
import { trainLittleBoy } from "./train";
import type { LittleBoyProfile } from "./types";

export const LITTLEBOY_PLUGIN_ID = "mouse_littleboy_v1";

/**
 * Warm-up length in ticks, one tick per second. The brief asks for one to two
 * minutes of capture; 90 s sits in the middle and keeps the whole warm-up
 * inside the 30-minute session TTL with room to spare.
 */
const WARMUP_TICKS = 90;
export const LITTLEBOY_WARMUP_SIZE = WARMUP_TICKS;

const SMOOTHING_WINDOW = ADDON_CONFIG.session.smoothing;
const TTL_SECONDS = 30 * 60;

/** A tick needs a couple of events before a mean error over it means anything. */
const MIN_TICK_EVENTS = 3;

/** Enough rows for the fit to mean anything, easily reached from a 90 s capture. */
const LIVE_MIN_ROWS = 400;

/**
 * train_pipeline_1.py's 50 epochs, but at a larger batch than its 32. On a
 * model this small a batch of 32 is almost pure per-step overhead in JS, and
 * the fit happens inline in a tick request that the user is waiting on.
 */
const LIVE_EPOCHS = 50;
const LIVE_BATCH = 128;

/**
 * Cap on captured rows. ~5 400 at a 60 Hz pointer over 90 s, so this only trips
 * on a runaway input device - but it bounds the Redis document, which is read
 * and written on every tick of the warm-up.
 */
const MAX_TRAIN_ROWS = 8000;

/**
 * Maps the calibrated cutoff (genuine mean + 3 sigma) onto the UI's 0.8
 * threshold, so the existing severity colours and escalation logic carry over:
 * sigmoid(3 / 2.164) = 0.8.
 */
const Z_TO_RISK_SCALE = 2.164;
const CUTOFF_SIGMA = 3;

type LittleBoyDoc = {
  /** Captured rows, as base64 Float32Array blocks - one per tick. Appending a
   * chunk avoids re-encoding the whole capture on every tick; they are
   * concatenated once, at fit time. Cleared once fitted. */
  chunks: string[];
  rowCount: number;
  /** Timestamp of the last event seen, so `time_delta` stays continuous across
   * tick boundaries. Kept updated after training too, for scoring. */
  lastT: number | null;
  /** Ticks with usable activity so far. Drives the progress ring. */
  warmupTicks: number;
  profile: LittleBoyProfile | null;
  rawHistoryTail: number[];
  /** Set when a fit was attempted and failed, so we stop retrying every tick. */
  fitError: string | null;
};

function fresh(): LittleBoyDoc {
  return {
    chunks: [],
    rowCount: 0,
    lastT: null,
    warmupTicks: 0,
    profile: null,
    rawHistoryTail: [],
    fitError: null,
  };
}

const key = (sid: string) => `bio:littleboy:${sid}`;

async function load(sid: string): Promise<LittleBoyDoc> {
  const raw = await getRedis().get<LittleBoyDoc>(key(sid));
  return raw ?? fresh();
}

async function save(sid: string, doc: LittleBoyDoc): Promise<void> {
  await getRedis().set(key(sid), doc, { ex: TTL_SECONDS });
}

export async function resetLittleBoy(sid: string): Promise<void> {
  await getRedis().del(key(sid));
}

/** Progress for the widget's warm-up ring, in the same shape as the gallery. */
export async function littleBoyProgress(sid: string): Promise<{ size: number; active: boolean }> {
  const doc = await load(sid);
  return { size: doc.profile ? WARMUP_TICKS : doc.warmupTicks, active: doc.profile !== null };
}

function encodeRows(data: Float32Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

/** Concatenate the captured chunks into one contiguous training matrix. */
function decodeChunks(chunks: string[], rowCount: number): Float32Array {
  const out = new Float32Array(rowCount * ROW_DIM);
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = Buffer.from(chunk, "base64");
    // Copy out of the Buffer pool: Node Buffers are views into a shared
    // ArrayBuffer, so the byteOffset matters.
    const floats = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    if (offset + floats.length > out.length) {
      out.set(floats.subarray(0, out.length - offset), offset);
      break;
    }
    out.set(floats, offset);
    offset += floats.length;
  }
  return out;
}

function inactive(reason: string): ModuleResult {
  return {
    plugin_id: LITTLEBOY_PLUGIN_ID,
    risk_score: 0,
    confidence: 0,
    status: "inactive",
    detail: { reason },
  };
}

export async function runLittleBoyModule(
  sid: string,
  events: MouseEvent2D[] | undefined,
): Promise<ModuleResult> {
  const window = events ?? [];
  if (window.length < MIN_TICK_EVENTS) {
    return inactive(`only ${window.length} events this tick (need ${MIN_TICK_EVENTS})`);
  }

  const doc = await load(sid);

  if (doc.fitError) {
    return {
      plugin_id: LITTLEBOY_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "error",
      detail: { reason: doc.fitError },
    };
  }

  const { data, rows, lastT } = eventsToRows(window, doc.lastT);
  doc.lastT = lastT;

  // --- warm-up ---------------------------------------------------------------
  if (!doc.profile) {
    if (doc.rowCount < MAX_TRAIN_ROWS) {
      const room = MAX_TRAIN_ROWS - doc.rowCount;
      const kept = Math.min(rows, room);
      doc.chunks.push(encodeRows(data.subarray(0, kept * ROW_DIM)));
      doc.rowCount += kept;
    }
    doc.warmupTicks++;

    if (doc.warmupTicks < WARMUP_TICKS) {
      await save(sid, doc);
      const remaining = WARMUP_TICKS - doc.warmupTicks;
      return {
        plugin_id: LITTLEBOY_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "warming",
        detail: {
          gallery_size: doc.warmupTicks,
          warmup_remaining: remaining,
          seconds_remaining: remaining,
          events_captured: doc.rowCount,
        },
      };
    }

    // --- fit -----------------------------------------------------------------
    try {
      const matrix = decodeChunks(doc.chunks, doc.rowCount);
      doc.profile = await trainLittleBoy(sid, matrix, doc.rowCount, {
        epochs: LIVE_EPOCHS,
        batchSize: LIVE_BATCH,
        thresholdSigma: CUTOFF_SIGMA,
        minRows: LIVE_MIN_ROWS,
        // Calibrate on blocks the size of an average tick from this very
        // capture, so the live per-tick mean is compared against a spread
        // measured over the same number of rows. Pointer sampling rates differ
        // enough between machines that a fixed constant would misjudge it.
        blockRows: Math.max(1, Math.round(doc.rowCount / doc.warmupTicks)),
      });
      doc.chunks = [];
      await save(sid, doc);
      return {
        plugin_id: LITTLEBOY_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "warming",
        detail: {
          gallery_size: WARMUP_TICKS,
          warmup_remaining: 0,
          seconds_remaining: 0,
          trained_rows: doc.profile.trainRows,
          genuine_mean: doc.profile.threshold.mean,
          cutoff: doc.profile.threshold.cutoff,
          calibrated_tick_rows: doc.profile.threshold.blockRows,
        },
      };
    } catch (error) {
      // Almost always "not enough activity": the user barely touched the mouse
      // for 90 s. Surface it rather than silently retraining every tick.
      doc.fitError = (error as Error).message;
      doc.chunks = [];
      doc.rowCount = 0;
      await save(sid, doc);
      return {
        plugin_id: LITTLEBOY_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "error",
        detail: { reason: doc.fitError },
      };
    }
  }

  // --- active ----------------------------------------------------------------
  const { mean, perRow } = await rowErrors(doc.profile, data, rows);
  const { mean: gMean, std: gStd, cutoff, rowCutoff } = doc.profile.threshold;
  const z = gStd > 0 ? (mean - gMean) / gStd : 0;
  const raw = sigmoid(z / Z_TO_RISK_SCALE);

  let anomalous = 0;
  for (let i = 0; i < rows; i++) if (perRow[i] > rowCutoff) anomalous++;

  doc.rawHistoryTail.push(raw);
  if (doc.rawHistoryTail.length > SMOOTHING_WINDOW) doc.rawHistoryTail.shift();
  const smoothed = smoothRisk(doc.rawHistoryTail, SMOOTHING_WINDOW);
  await save(sid, doc);

  return {
    plugin_id: LITTLEBOY_PLUGIN_ID,
    risk_score: smoothed,
    confidence: 1.0,
    status: "active",
    detail: {
      raw_risk: raw,
      recon_error: mean,
      genuine_mean: gMean,
      cutoff,
      z,
      anomalous_row_fraction: anomalous / rows,
      events: rows,
      trained_rows: doc.profile.trainRows,
    },
  };
}
