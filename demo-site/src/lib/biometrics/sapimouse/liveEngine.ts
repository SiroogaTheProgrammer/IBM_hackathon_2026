/**
 * Live scoring with the SapiMouse encoder, in the same shape as
 * `balabit_features_embed`: collect the user's own embeddings during warm-up,
 * fit a risk model against an impostor background, then score each new
 * embedding by how far it sits from that gallery.
 *
 * One structural difference drives the whole design. The balabit engine turns
 * ONE tick (~1 s of events) into one embedding. This encoder consumes a window
 * of 12 segmented *strokes*, and at SapiMouse's observed rate a stroke takes
 * roughly a second - so a single tick never contains a scoreable window. The
 * engine therefore keeps a rolling raw-event buffer across ticks, segments it
 * on every tick, and emits an embedding only once 12 valid strokes exist,
 * sliding by `STRIDE` strokes each time.
 *
 * State lives in its own Redis document, like the autoencoder engine, so
 * switching engines in the UI resumes rather than restarts.
 */

import { getRedis } from "../redis";
import { BACKGROUND_SIZE, TARGET_FALSE_ALARM, ADDON_CONFIG } from "../config";
import { distanceStats } from "../distanceStats";
import {
  fitRiskModel, riskScore, smoothRisk, trailingMeanSeries, calibrateThreshold,
  type RiskModel,
} from "../riskModel";
import type { MouseEvent2D, ModuleResult } from "../types";
import { cleanEvents, segmentStrokes } from "./segment";
import { strokeFeatures, type FeatureRow } from "./features";
import { applyPreprocessor } from "./preprocess";
import { CONFIG, PREP, N_STROKES, STRIDE, PREPROCESSOR, embedWindows } from "./index";
import backgroundJson from "./model/sapimouse-background.json";

export const SAPIMOUSE_PLUGIN_ID = "mouse_sapimouse_v1";

/** Gallery target. Smaller than the balabit engine's 60 because each entry
 * costs ~`STRIDE` strokes of mousing rather than one second: 30 windows is
 * about 70 strokes, comparable wall-clock warm-up for the user. */
const WARMUP_SIZE = 30;
const SMOOTHING_WINDOW = ADDON_CONFIG.session.smoothing;

/** Cap the rolling buffer so an idle session cannot grow it without bound.
 * 2500 events is ~45 s at 60 Hz, comfortably more than one window needs. */
const MAX_BUFFER_EVENTS = 2500;
const SESSION_TTL_SECONDS = 30 * 60;

type SapiDoc = {
  buffer: MouseEvent2D[];
  gallery: number[][];
  riskModel: RiskModel | null;
  threshold: number;
  rawHistoryTail: number[];
  strokesSeen: number;
};

function fresh(): SapiDoc {
  return { buffer: [], gallery: [], riskModel: null, threshold: 0.8, rawHistoryTail: [], strokesSeen: 0 };
}

const key = (sid: string) => `bio:sapimouse:${sid}`;

async function load(sid: string): Promise<SapiDoc> {
  const doc = await getRedis().get<SapiDoc>(key(sid));
  return doc ?? fresh();
}

async function save(sid: string, doc: SapiDoc): Promise<void> {
  await getRedis().set(key(sid), doc, { ex: SESSION_TTL_SECONDS });
}

export async function resetSapimouse(sid: string): Promise<void> {
  await getRedis().del(key(sid));
}

export async function sapimouseProgress(sid: string): Promise<{ size: number; active: boolean }> {
  const doc = await load(sid);
  return { size: doc.gallery.length, active: doc.gallery.length >= WARMUP_SIZE };
}

export const SAPIMOUSE_WARMUP_SIZE = WARMUP_SIZE;

/** Strokes that survive both the validity gate and the QC filter, with their
 * features - the same two-stage filter the training pipeline applies. */
function usableStrokes(events: MouseEvent2D[]): { tStart: number; feat: FeatureRow }[] {
  const strokes = segmentStrokes(cleanEvents(events, PREP), CONFIG);
  const out: { tStart: number; feat: FeatureRow }[] = [];
  for (const s of strokes) {
    if (s.t.length < CONFIG.min_points) continue;
    let path = 0;
    for (let i = 1; i < s.x.length; i++) path += Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
    if (path < CONFIG.min_path_px) continue;
    if (s.t[s.t.length - 1] - s.t[0] < CONFIG.min_duration_s) continue;

    const feat = strokeFeatures(s, CONFIG);
    if (feat.v_max !== null && feat.v_max > PREP.max_speed_px_s) continue;
    if (feat.path_len !== null && feat.path_len > PREP.max_path_px) continue;
    if (PREP.drop_zero_var_strokes && (feat.v_std === 0 || feat.bbox_area === 0)) continue;
    if (feat.duration === null || !Number.isFinite(feat.duration) || feat.duration <= 0) continue;
    out.push({ tStart: s.t[0], feat });
  }
  return out;
}

function fitGallery(doc: SapiDoc): void {
  const all = (backgroundJson as { vectors: number[][] }).vectors;
  const pool = all.length > BACKGROUND_SIZE
    ? all.slice().sort(() => Math.random() - 0.5).slice(0, BACKGROUND_SIZE)
    : all;
  const genuine = doc.gallery.map((_, i) => distanceStats(doc.gallery[i], doc.gallery, i));
  const impostor = pool.map((v) => distanceStats(v, doc.gallery));
  const model = fitRiskModel(genuine, impostor);
  doc.riskModel = model;
  const calibration = genuine.map((s) => riskScore(model, s));
  doc.threshold = calibrateThreshold(
    trailingMeanSeries(calibration, SMOOTHING_WINDOW), TARGET_FALSE_ALARM);
}

export async function runSapimouseModule(
  sid: string,
  events: MouseEvent2D[] | undefined,
): Promise<ModuleResult> {
  const doc = await load(sid);
  const incoming = events ?? [];

  // Clock reset: `performance.now()` restarts at 0 on every page load, but the
  // session document survives in Redis for 30 minutes. Without this, stale
  // buffer entries stamped at t=500 would make every fresh event at t=0.3 look
  // out-of-order, `cleanEvents` would drop all of them, and the engine would
  // sit at "0/12 strokes buffered" until the TTL expired.
  const lastBuffered = doc.buffer.length ? doc.buffer[doc.buffer.length - 1].t : -Infinity;
  if (incoming.length && incoming[0].t < lastBuffered) doc.buffer = [];

  doc.buffer.push(...incoming);
  if (doc.buffer.length > MAX_BUFFER_EVENTS) {
    doc.buffer = doc.buffer.slice(doc.buffer.length - MAX_BUFFER_EVENTS);
  }

  const strokes = usableStrokes(doc.buffer);

  // Not enough movement yet to form a window: report progress rather than a
  // score. This is the normal state for the first ~15 s and is not an error.
  if (strokes.length < N_STROKES) {
    await save(sid, doc);
    return {
      plugin_id: SAPIMOUSE_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "inactive",
      detail: {
        reason: `${strokes.length}/${N_STROKES} strokes buffered`,
        strokes_buffered: strokes.length,
        strokes_needed: N_STROKES,
        gallery_size: doc.gallery.length,
      },
    };
  }

  // Embed the most recent complete window, then drop the events belonging to
  // the oldest STRIDE strokes so the next window slides forward.
  const window = strokes.slice(strokes.length - N_STROKES);
  const scaled = applyPreprocessor(window.map((s) => s.feat), PREPROCESSOR);
  const [vector] = embedWindows([scaled]);
  doc.strokesSeen += 1;

  const cutIndex = strokes.length - N_STROKES + STRIDE;
  const cutT = strokes[Math.min(cutIndex, strokes.length - 1)].tStart;
  doc.buffer = doc.buffer.filter((e) => e.t >= cutT);

  const embedding = Array.from(vector);

  if (doc.gallery.length < WARMUP_SIZE) {
    doc.gallery.push(embedding);
    const remaining = WARMUP_SIZE - doc.gallery.length;
    if (remaining === 0) fitGallery(doc);
    await save(sid, doc);
    return {
      plugin_id: SAPIMOUSE_PLUGIN_ID,
      risk_score: 0,
      confidence: 0,
      status: "warming",
      detail: {
        gallery_size: doc.gallery.length,
        warmup_remaining: remaining,
        seconds_remaining: remaining,
      },
    };
  }

  const model = doc.riskModel;
  if (!model) {
    await save(sid, doc);
    return {
      plugin_id: SAPIMOUSE_PLUGIN_ID, risk_score: 0, confidence: 0, status: "warming",
      detail: { reason: "risk model not fitted yet" },
    };
  }

  const stats = distanceStats(embedding, doc.gallery);
  const raw = riskScore(model, stats);
  doc.rawHistoryTail.push(raw);
  if (doc.rawHistoryTail.length > SMOOTHING_WINDOW) doc.rawHistoryTail.shift();
  const smoothed = smoothRisk(doc.rawHistoryTail, SMOOTHING_WINDOW);
  await save(sid, doc);

  return {
    plugin_id: SAPIMOUSE_PLUGIN_ID,
    risk_score: smoothed,
    confidence: 1.0,
    status: "active",
    detail: {
      raw_risk: raw,
      threshold: doc.threshold,
      gallery_size: doc.gallery.length,
      cos_min: stats[0],
      cos_mean: stats[4],
      cos_centroid: stats[6],
      windows_scored: doc.strokesSeen,
    },
  };
}
