/**
 * The live per-session state machine for the `balabit_autoencoder` engine.
 *
 * Mirrors what `session.ts` does for the embedding engine, but with an
 * autoencoder in place of the gallery + risk model:
 *
 *   warm-up   collect raw mouse events for WARMUP_TICKS ticks (~60 s)
 *   fit       re-window the whole capture, train, calibrate a cutoff
 *   active    score each incoming tick by reconstruction error
 *
 * State lives under its own Redis key rather than inside the main session
 * document: the raw warm-up capture is ~100 KB of events and the trained
 * model another ~45 KB, and the embedding engine should not pay to parse
 * either on every tick when it is the one selected.
 */

import { ADDON_CONFIG } from "../config";
import { sigmoid } from "../math";
import { getRedis } from "../redis";
import { smoothRisk } from "../riskModel";
import type { ModuleResult, MouseEvent2D } from "../types";
import { countMovementEvents, MIN_MOVE_EVENTS } from "../featureExtractor";
import { DEFAULT_WINDOW_SECONDS, ENROL_HOP_SECONDS, eventsToWindowFeatures } from "./features";
import { windowErrors } from "./score";
import { trainUserModel } from "./train";
import type { UserProfile } from "./types";

export const AUTOENCODER_PLUGIN_ID = "mouse_autoencoder_v1";

const WARMUP_TICKS = ADDON_CONFIG.session.warmup_size;
const SMOOTHING_WINDOW = ADDON_CONFIG.session.smoothing;
const TTL_SECONDS = 30 * 60;

/** Enough rows for the fit to mean anything, reachable from a ~60 s capture. */
const LIVE_MIN_WINDOWS = 80;
const LIVE_EPOCHS = 120;
const LIVE_BATCH = 64;

/**
 * Guard against a pathological capture blowing the Redis value limit. At a
 * typical 10-20 events/s a 60 s warm-up is ~1k events, so this only ever
 * trips on a runaway input device.
 */
const MAX_WARMUP_EVENTS = 40_000;

/**
 * Maps the calibrated cutoff (genuine mean + 3σ) onto the UI's 0.8 threshold,
 * so the existing severity colours and escalation logic carry over unchanged:
 * sigmoid(3 / 2.164) = 0.8.
 */
const Z_TO_RISK_SCALE = 2.164;
const CUTOFF_SIGMA = 3;

type AutoencoderDoc = {
  /** Raw events captured so far during warm-up. Cleared once fitted. */
  warmupEvents: MouseEvent2D[];
  /** Ticks with usable movement seen so far. Drives the progress display. */
  warmupTicks: number;
  profile: UserProfile | null;
  rawHistoryTail: number[];
  /** Set when a fit was attempted and failed, so we stop retrying every tick. */
  fitError: string | null;
};

function fresh(): AutoencoderDoc {
  return { warmupEvents: [], warmupTicks: 0, profile: null, rawHistoryTail: [], fitError: null };
}

const key = (sid: string) => `bio:ae:${sid}`;

async function load(sid: string): Promise<AutoencoderDoc> {
  const raw = await getRedis().get<AutoencoderDoc>(key(sid));
  return raw ?? fresh();
}

async function save(sid: string, doc: AutoencoderDoc): Promise<void> {
  await getRedis().set(key(sid), doc, { ex: TTL_SECONDS });
}

export async function resetAutoencoder(sid: string): Promise<void> {
  await getRedis().del(key(sid));
}

/** Progress for the widget's warm-up ring, in the same shape as the gallery. */
export async function autoencoderProgress(sid: string): Promise<{ size: number; active: boolean }> {
  const doc = await load(sid);
  return { size: doc.profile ? WARMUP_TICKS : doc.warmupTicks, active: doc.profile !== null };
}

export async function runAutoencoderModule(
  sid: string,
  events: MouseEvent2D[] | undefined,
): Promise<ModuleResult> {
  const window = events ?? [];
  const nMoves = countMovementEvents(window);
  if (nMoves < MIN_MOVE_EVENTS) {
    return {
      plugin_id: AUTOENCODER_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "inactive",
      detail: { reason: `only ${nMoves} movement samples (need ${MIN_MOVE_EVENTS})` },
    };
  }

  const doc = await load(sid);

  if (doc.fitError) {
    return {
      plugin_id: AUTOENCODER_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "error",
      detail: { reason: doc.fitError },
    };
  }

  // --- warm-up -------------------------------------------------------------
  if (!doc.profile) {
    if (doc.warmupEvents.length < MAX_WARMUP_EVENTS) {
      doc.warmupEvents.push(...window);
    }
    doc.warmupTicks++;

    if (doc.warmupTicks < WARMUP_TICKS) {
      await save(sid, doc);
      const remaining = WARMUP_TICKS - doc.warmupTicks;
      return {
        plugin_id: AUTOENCODER_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "warming",
        detail: {
          gallery_size: doc.warmupTicks,
          warmup_remaining: remaining,
          seconds_remaining: remaining,
          events_captured: doc.warmupEvents.length,
        },
      };
    }

    // --- fit ---------------------------------------------------------------
    // Re-window the whole capture at once. Windowing per tick would cap us at
    // one row per second and would also miss every movement that straddles a
    // tick boundary.
    const { data, rows } = eventsToWindowFeatures(
      doc.warmupEvents,
      DEFAULT_WINDOW_SECONDS,
      ENROL_HOP_SECONDS,
    );

    try {
      doc.profile = await trainUserModel(sid, data, rows, {
        epochs: LIVE_EPOCHS,
        batchSize: LIVE_BATCH,
        thresholdSigma: CUTOFF_SIGMA,
        minWindows: LIVE_MIN_WINDOWS,
      });
      doc.warmupEvents = [];
      await save(sid, doc);
      return {
        plugin_id: AUTOENCODER_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "warming",
        detail: {
          gallery_size: WARMUP_TICKS,
          warmup_remaining: 0,
          seconds_remaining: 0,
          trained_windows: doc.profile.trainRows,
        },
      };
    } catch (error) {
      // Most often "not enough windows": the user barely moved the mouse for a
      // minute. Surface it instead of silently retraining every tick.
      doc.fitError = (error as Error).message;
      doc.warmupEvents = [];
      await save(sid, doc);
      return {
        plugin_id: AUTOENCODER_PLUGIN_ID,
        risk_score: 0,
        confidence: 0,
        status: "error",
        detail: { reason: doc.fitError },
      };
    }
  }

  // --- active --------------------------------------------------------------
  const { data, rows } = eventsToWindowFeatures(window);
  if (rows === 0) {
    return {
      plugin_id: AUTOENCODER_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "inactive",
      detail: { reason: "no complete movement window in this tick" },
    };
  }

  const { mean } = await windowErrors(doc.profile, data, rows);
  const { mean: gMean, std: gStd } = doc.profile.threshold;
  const z = gStd > 0 ? (mean - gMean) / gStd : 0;
  const raw = sigmoid(z / Z_TO_RISK_SCALE);

  doc.rawHistoryTail.push(raw);
  if (doc.rawHistoryTail.length > SMOOTHING_WINDOW) doc.rawHistoryTail.shift();
  const smoothed = smoothRisk(doc.rawHistoryTail, SMOOTHING_WINDOW);
  await save(sid, doc);

  return {
    plugin_id: AUTOENCODER_PLUGIN_ID,
    risk_score: smoothed,
    confidence: 1.0,
    status: "active",
    detail: {
      raw_risk: raw,
      recon_error: mean,
      genuine_mean: gMean,
      cutoff: doc.profile.threshold.cutoff,
      z,
      windows: rows,
      trained_windows: doc.profile.trainRows,
    },
  };
}
