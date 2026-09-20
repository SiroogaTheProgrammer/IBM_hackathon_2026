/**
 * Per-session orchestration: the serverless equivalent of `demo/server.py` +
 * `behavioral_biometrics_nn/live.py`'s `LiveSession` combined. Vercel
 * functions are stateless between invocations, so everything `LiveSession`
 * used to keep in memory (gallery, fitted risk model, streak/escalation,
 * tab-nav/keystroke baselines) is persisted as one JSON document in Upstash
 * Redis, keyed by an httpOnly session cookie, with a TTL so abandoned
 * sessions don't accumulate forever.
 */

import { cookies } from "next/headers";
import { randomUUID } from "crypto";

import { getRedis } from "./redis";
import { ADDON_CONFIG, BACKGROUND_SIZE, TARGET_FALSE_ALARM } from "./config";
import { extractWindowFeatures, countMovementEvents, MIN_MOVE_EVENTS } from "./featureExtractor";
import { scaleFeatures, scaleFeaturesBig } from "./scaler";
import { embed, embedBig } from "./encoder";
import { distanceStats } from "./distanceStats";
import { fitRiskModel, riskScore, smoothRisk, trailingMeanSeries, calibrateThreshold, type RiskModel } from "./riskModel";
import mouseBackgroundJson from "./model/mouseBackground.json";
import mouseBackgroundBigJson from "./model/mouseBackgroundBig.json";
import { initTabNavState, updateTabNavigation, type TabNavState } from "./tabNavigation";
import { initKeystrokeState, updateKeystroke, type KeystrokeState } from "./keystroke";
import { updateComposite, type CompositeState } from "./composite";
import { DEFAULT_ENGINE, type MouseEngine, type ModuleResult, type TickPayload, type TickResponse } from "./types";
import { autoencoderProgress, resetAutoencoder, runAutoencoderModule } from "./autoencoder/liveEngine";
import { sapimouseProgress, resetSapimouse, runSapimouseModule, SAPIMOUSE_WARMUP_SIZE } from "./sapimouse/liveEngine";
import { littleBoyProgress, resetLittleBoy, runLittleBoyModule, LITTLEBOY_WARMUP_SIZE } from "./littleboy/liveEngine";

const SESSION_COOKIE = "bio_sid";
const SESSION_TTL_SECONDS = 30 * 60;
const IDLE_ACTIVITY_THRESHOLD = 0.18;
const IDLE_MAX_EVENT_COUNT = 2;

const WARMUP_SIZE = ADDON_CONFIG.session.warmup_size;
const SMOOTHING_WINDOW = ADDON_CONFIG.session.smoothing;

type SessionDoc = {
  gallery: number[][];
  riskModel: RiskModel | null;
  threshold: number;
  rawHistoryTail: number[];
  // Separate warm-up state for the "big" combined-dataset encoder - its
  // embeddings live in a different space, so they cannot share a gallery or
  // fitted risk model with the default engine's fields above.
  galleryBig: number[][];
  riskModelBig: RiskModel | null;
  thresholdBig: number;
  rawHistoryTailBig: number[];
  streak: number;
  escalated: boolean;
  tabNav: TabNavState;
  keystroke: KeystrokeState;
};

function freshSession(): SessionDoc {
  return {
    gallery: [],
    riskModel: null,
    threshold: 0.8,
    rawHistoryTail: [],
    galleryBig: [],
    riskModelBig: null,
    thresholdBig: 0.8,
    rawHistoryTailBig: [],
    streak: 0,
    escalated: false,
    tabNav: initTabNavState(),
    keystroke: initKeystrokeState(),
  };
}

function redisKey(id: string): string {
  return `bio:session:${id}`;
}

export async function getSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) return existing;
  const id = randomUUID();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return id;
}

async function loadSession(id: string): Promise<SessionDoc> {
  const raw = await getRedis().get<SessionDoc>(redisKey(id));
  return raw ?? freshSession();
}

async function saveSession(id: string, doc: SessionDoc): Promise<void> {
  await getRedis().set(redisKey(id), doc, { ex: SESSION_TTL_SECONDS });
}

export async function resetSession(id: string): Promise<void> {
  // Clear both engines' state - the UI's Reset/Quit buttons are not
  // engine-specific, and leaving one engine's gallery behind would make a
  // "reset" look like it had no effect after switching the dropdown.
  await Promise.all([
    getRedis().del(redisKey(id)),
    resetAutoencoder(id),
    resetSapimouse(id),
    resetLittleBoy(id),
  ]);
}

function isIdleTick(payload: TickPayload): boolean {
  if ((payload.keys?.length ?? 0) > 0 || (payload.nav?.length ?? 0) > 0) return false;

  const events = payload.events ?? [];
  if (events.length > IDLE_MAX_EVENT_COUNT) return false;
  if (events.length === 0) return true;

  let totalDistance = 0;
  for (const e of events) totalDistance += Math.abs(e.x ?? 0) + Math.abs(e.y ?? 0);
  return totalDistance <= IDLE_ACTIVITY_THRESHOLD;
}

function idleResponse(): TickResponse {
  return {
    idle: true,
    composite_risk: 0,
    verdict: "IDLE",
    modules: [],
    session: { status: "idle", gallery_size: 0, warmup_size: 0, gallery_mode: "" },
    threshold: 0.8,
    streak: 0,
    active_modules: 0,
    escalated: false,
    hard_triggered: null,
  };
}

/** Random sample of `n` indices in `[0, total)` without replacement. */
function sampleIndices(total: number, n: number): number[] {
  const pool = Array.from({ length: total }, (_, i) => i);
  const count = Math.min(n, total);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (total - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function fitGallery(session: SessionDoc): void {
  const backgroundAll = (mouseBackgroundJson as { vectors: number[][] }).vectors;
  const idx = sampleIndices(backgroundAll.length, BACKGROUND_SIZE);
  const background = idx.map((i) => backgroundAll[i]);

  const genuine = session.gallery.map((_, i) => distanceStats(session.gallery[i], session.gallery, i));
  const impostor = background.map((v) => distanceStats(v, session.gallery));
  const model = fitRiskModel(genuine, impostor);
  session.riskModel = model;

  const calibrationScores = genuine.map((stats) => riskScore(model, stats));
  const smoothedSeries = trailingMeanSeries(calibrationScores, SMOOTHING_WINDOW);
  session.threshold = calibrateThreshold(smoothedSeries, TARGET_FALSE_ALARM);
}

/** Same calibration as `fitGallery`, against the big model's own background
 * bank and gallery/threshold fields. */
function fitGalleryBig(session: SessionDoc): void {
  const backgroundAll = (mouseBackgroundBigJson as { vectors: number[][] }).vectors;
  const idx = sampleIndices(backgroundAll.length, BACKGROUND_SIZE);
  const background = idx.map((i) => backgroundAll[i]);

  const genuine = session.galleryBig.map((_, i) => distanceStats(session.galleryBig[i], session.galleryBig, i));
  const impostor = background.map((v) => distanceStats(v, session.galleryBig));
  const model = fitRiskModel(genuine, impostor);
  session.riskModelBig = model;

  const calibrationScores = genuine.map((stats) => riskScore(model, stats));
  const smoothedSeries = trailingMeanSeries(calibrationScores, SMOOTHING_WINDOW);
  session.thresholdBig = calibrateThreshold(smoothedSeries, TARGET_FALSE_ALARM);
}

function runMouseModule(session: SessionDoc, events: TickPayload["events"]): ModuleResult {
  const window = events ?? [];
  const nMoves = countMovementEvents(window);
  if (nMoves < MIN_MOVE_EVENTS) {
    return {
      plugin_id: "mouse_base_v1",
      risk_score: 0,
      confidence: 0,
      status: "inactive",
      detail: { reason: `only ${nMoves} movement samples (need ${MIN_MOVE_EVENTS})` },
    };
  }

  const features = extractWindowFeatures(window);
  const scaled = scaleFeatures(features);
  const vector = embed(scaled);

  if (session.gallery.length < WARMUP_SIZE) {
    session.gallery.push(vector);
    const remaining = Math.max(0, WARMUP_SIZE - session.gallery.length);
    if (remaining === 0) fitGallery(session);
    return {
      plugin_id: "mouse_base_v1",
      risk_score: 0,
      confidence: 0,
      status: "warming",
      detail: { gallery_size: session.gallery.length, warmup_remaining: remaining, seconds_remaining: remaining },
    };
  }

  const model = session.riskModel;
  if (!model) {
    // Defensive: should be unreachable (gallery full implies fitGallery ran).
    return { plugin_id: "mouse_base_v1", risk_score: 0, confidence: 0, status: "warming", detail: { reason: "risk model not fitted yet" } };
  }

  const stats = distanceStats(vector, session.gallery);
  const raw = riskScore(model, stats);
  session.rawHistoryTail.push(raw);
  if (session.rawHistoryTail.length > SMOOTHING_WINDOW) session.rawHistoryTail.shift();
  const smoothed = smoothRisk(session.rawHistoryTail, SMOOTHING_WINDOW);

  return {
    plugin_id: "mouse_base_v1",
    risk_score: smoothed,
    confidence: 1.0,
    status: "active",
    detail: {
      raw_risk: raw,
      threshold: session.threshold,
      gallery_size: session.gallery.length,
      cos_min: stats[0],
      cos_mean: stats[4],
      cos_centroid: stats[6],
    },
  };
}

/** Same warm-up/scoring flow as `runMouseModule`, using the big model's
 * encoder/scaler and its own gallery/threshold state. */
function runMouseModuleBig(session: SessionDoc, events: TickPayload["events"]): ModuleResult {
  const window = events ?? [];
  const nMoves = countMovementEvents(window);
  if (nMoves < MIN_MOVE_EVENTS) {
    return {
      plugin_id: "mouse_base_big_v1",
      risk_score: 0,
      confidence: 0,
      status: "inactive",
      detail: { reason: `only ${nMoves} movement samples (need ${MIN_MOVE_EVENTS})` },
    };
  }

  const features = extractWindowFeatures(window);
  const scaled = scaleFeaturesBig(features);
  const vector = embedBig(scaled);

  if (session.galleryBig.length < WARMUP_SIZE) {
    session.galleryBig.push(vector);
    const remaining = Math.max(0, WARMUP_SIZE - session.galleryBig.length);
    if (remaining === 0) fitGalleryBig(session);
    return {
      plugin_id: "mouse_base_big_v1",
      risk_score: 0,
      confidence: 0,
      status: "warming",
      detail: { gallery_size: session.galleryBig.length, warmup_remaining: remaining, seconds_remaining: remaining },
    };
  }

  const model = session.riskModelBig;
  if (!model) {
    // Defensive: should be unreachable (gallery full implies fitGalleryBig ran).
    return { plugin_id: "mouse_base_big_v1", risk_score: 0, confidence: 0, status: "warming", detail: { reason: "risk model not fitted yet" } };
  }

  const stats = distanceStats(vector, session.galleryBig);
  const raw = riskScore(model, stats);
  session.rawHistoryTailBig.push(raw);
  if (session.rawHistoryTailBig.length > SMOOTHING_WINDOW) session.rawHistoryTailBig.shift();
  const smoothed = smoothRisk(session.rawHistoryTailBig, SMOOTHING_WINDOW);

  return {
    plugin_id: "mouse_base_big_v1",
    risk_score: smoothed,
    confidence: 1.0,
    status: "active",
    detail: {
      raw_risk: raw,
      threshold: session.thresholdBig,
      gallery_size: session.galleryBig.length,
      cos_min: stats[0],
      cos_mean: stats[4],
      cos_centroid: stats[6],
    },
  };
}

function sessionInfo(engine: MouseEngine, gallerySize: number) {
  // Each engine fills its gallery at a different rate, so the progress bar has
  // to know which target it is counting towards.
  const target =
    engine === "sapimouse_features_embed" ? SAPIMOUSE_WARMUP_SIZE
    : engine === "little_boy" ? LITTLEBOY_WARMUP_SIZE
    : WARMUP_SIZE;
  const mode =
    engine === "balabit_autoencoder" ? "autoencoder"
    : engine === "sapimouse_features_embed" ? "sapimouse"
    : engine === "little_boy" ? "littleboy"
    : ADDON_CONFIG.session.gallery_mode;
  return {
    status: gallerySize >= target ? "active" : "warming",
    gallery_size: gallerySize,
    warmup_size: target,
    gallery_mode: mode,
  };
}

export async function processTick(payload: TickPayload): Promise<TickResponse> {
  if (isIdleTick(payload)) return idleResponse();

  const engine: MouseEngine = payload.engine ?? DEFAULT_ENGINE;
  const sid = await getSessionId();
  const session = await loadSession(sid);

  // Each engine keeps its own warm-up state, so switching between them in the
  // UI resumes rather than restarting the one you switch back to.
  const mouseResult =
    engine === "balabit_autoencoder"
      ? await runAutoencoderModule(sid, payload.events)
      : engine === "sapimouse_features_embed"
        ? await runSapimouseModule(sid, payload.events)
        : engine === "little_boy"
          ? await runLittleBoyModule(sid, payload.events)
          : engine === "balabit_features_embed_big"
            ? runMouseModuleBig(session, payload.events)
            : runMouseModule(session, payload.events);
  const tabOutcome = updateTabNavigation(
    session.tabNav,
    (payload.nav ?? []).map((v) => ({ tab: String(v.tab ?? ""), dwell: Number(v.dwell ?? 0) })),
  );
  const keyOutcome = updateKeystroke(session.keystroke, payload.keys ?? []);

  const results: ModuleResult[] = [
    mouseResult,
    {
      plugin_id: "tab_navigation_v1",
      risk_score: tabOutcome.risk,
      confidence: tabOutcome.confidence,
      status: tabOutcome.status,
      detail: tabOutcome.detail,
    },
    {
      plugin_id: "keystroke_v1",
      risk_score: keyOutcome.risk,
      confidence: keyOutcome.confidence,
      status: keyOutcome.status,
      detail: keyOutcome.detail,
    },
  ];

  // The autoencoder engine folds its own per-user calibration into the risk
  // value itself (its mean+3sigma cutoff maps to exactly 0.8), so it uses the
  // fixed threshold rather than the embedding engine's fitted one.
  const effectiveThreshold =
    engine === "balabit_autoencoder" || engine === "little_boy"
      ? ADDON_CONFIG.session.threshold
      : engine === "sapimouse_features_embed"
        // fitted per-user by that engine's own fitGallery and reported in its
        // module detail; fall back to the global default until it has one
        ? (typeof mouseResult.detail.threshold === "number"
            ? mouseResult.detail.threshold
            : ADDON_CONFIG.session.threshold)
        : engine === "balabit_features_embed_big"
          ? session.thresholdBig
          : session.threshold;

  const compositeState: CompositeState = { streak: session.streak, escalated: session.escalated };
  const outcome = updateComposite(
    compositeState,
    {
      weights: {
        mouse_base_v1: ADDON_CONFIG.modules.mouse_base_v1.weight,
        mouse_autoencoder_v1: ADDON_CONFIG.modules.mouse_autoencoder_v1.weight,
        mouse_sapimouse_v1: ADDON_CONFIG.modules.mouse_sapimouse_v1.weight,
        mouse_littleboy_v1: ADDON_CONFIG.modules.mouse_littleboy_v1.weight,
        mouse_base_big_v1: ADDON_CONFIG.modules.mouse_base_big_v1.weight,
        tab_navigation_v1: ADDON_CONFIG.modules.tab_navigation_v1.weight,
        keystroke_v1: ADDON_CONFIG.modules.keystroke_v1.weight,
      },
      hardTriggers: {
        tab_navigation_v1: ADDON_CONFIG.modules.tab_navigation_v1.hardTrigger ?? Infinity,
      },
      // Use this session's own calibrated threshold (set by `fitGallery` from
      // this user's warm-up distribution), not the fixed global default -
      // otherwise users whose natural score distribution sits well below the
      // 0.8 fallback (see artifacts/report.txt's per-user `thresh` column,
      // e.g. ~0.37 for some users) would almost never escalate, even for a
      // blatant impostor.
      threshold: effectiveThreshold,
      cycles: ADDON_CONFIG.session.cycles,
    },
    results.map((r) => ({ pluginId: r.plugin_id, risk: r.risk_score, confidence: r.confidence, status: r.status })),
  );

  session.streak = compositeState.streak;
  session.escalated = compositeState.escalated;
  await saveSession(sid, session);

  return {
    composite_risk: outcome.compositeRisk,
    verdict: outcome.verdict,
    streak: outcome.streak,
    escalated: outcome.escalated,
    threshold: effectiveThreshold,
    hard_triggered: outcome.hardTriggered,
    active_modules: outcome.activeModules,
    modules: results,
    session: sessionInfo(
      engine,
      engine === "balabit_autoencoder"
        ? (await autoencoderProgress(sid)).size
        : engine === "sapimouse_features_embed"
          ? (await sapimouseProgress(sid)).size
          : engine === "little_boy"
            ? (await littleBoyProgress(sid)).size
            : engine === "balabit_features_embed_big"
              ? session.galleryBig.length
              : session.gallery.length,
    ),
  };
}

export function getConfigPayload() {
  return {
    modules: [
      {
        plugin_id: "mouse_base_v1",
        display_name: ADDON_CONFIG.modules.mouse_base_v1.displayName,
        weight: ADDON_CONFIG.modules.mouse_base_v1.weight,
        is_base: true,
        hard_trigger: ADDON_CONFIG.modules.mouse_base_v1.hardTrigger,
      },
      {
        plugin_id: "mouse_sapimouse_v1",
        display_name: ADDON_CONFIG.modules.mouse_sapimouse_v1.displayName,
        weight: ADDON_CONFIG.modules.mouse_sapimouse_v1.weight,
        is_base: true,
        hard_trigger: ADDON_CONFIG.modules.mouse_sapimouse_v1.hardTrigger,
      },
      {
        plugin_id: "mouse_littleboy_v1",
        display_name: ADDON_CONFIG.modules.mouse_littleboy_v1.displayName,
        weight: ADDON_CONFIG.modules.mouse_littleboy_v1.weight,
        is_base: true,
        hard_trigger: ADDON_CONFIG.modules.mouse_littleboy_v1.hardTrigger,
      },
      {
        plugin_id: "mouse_base_big_v1",
        display_name: ADDON_CONFIG.modules.mouse_base_big_v1.displayName,
        weight: ADDON_CONFIG.modules.mouse_base_big_v1.weight,
        is_base: true,
        hard_trigger: ADDON_CONFIG.modules.mouse_base_big_v1.hardTrigger,
      },
      {
        plugin_id: "tab_navigation_v1",
        display_name: ADDON_CONFIG.modules.tab_navigation_v1.displayName,
        weight: ADDON_CONFIG.modules.tab_navigation_v1.weight,
        is_base: false,
        hard_trigger: ADDON_CONFIG.modules.tab_navigation_v1.hardTrigger,
      },
      {
        plugin_id: "keystroke_v1",
        display_name: ADDON_CONFIG.modules.keystroke_v1.displayName,
        weight: ADDON_CONFIG.modules.keystroke_v1.weight,
        is_base: false,
        hard_trigger: ADDON_CONFIG.modules.keystroke_v1.hardTrigger,
      },
    ],
    threshold: ADDON_CONFIG.session.threshold,
    cycles: ADDON_CONFIG.session.cycles,
    warmup_size: WARMUP_SIZE,
    gallery_mode: ADDON_CONFIG.session.gallery_mode,
    smoothing: SMOOTHING_WINDOW,
  };
}
