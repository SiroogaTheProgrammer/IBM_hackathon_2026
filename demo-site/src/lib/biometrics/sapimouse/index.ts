/**
 * SapiMouse mouse-dynamics verification, running in the Next.js server on
 * TensorFlow.js.
 *
 *   import { enrol, verify } from "@/lib/biometrics/sapimouse";
 *   const template = enrol(enrolEvents);
 *   const result   = verify(probeEvents, template);   // { score, accept, ... }
 *
 * Trained on 90 of SapiMouse's 120 users; thresholds calibrated on 20 users the
 * encoder never saw. Measured open-set performance (users never trained on,
 * enrolled from one recording and verified from another) is in
 * `encoder2/sapimouse_features.ipynb` - quote that, not the calibration table,
 * when reporting what this can do.
 *
 * Every step from raw events to embedding is a port of the Python that produced
 * those numbers, checked to ~1e-4 by `scripts/sapimouseParity.ts`.
 */
import modelJson from "./model/sapimouse-encoder.json";
import { cleanEvents, segmentStrokes } from "./segment";
import { strokeFeatures, type FeatureRow } from "./features";
import { applyPreprocessor, type Preprocessor } from "./preprocess";
import { WindowEncoder } from "./encoder";
import type { RawEvent, SegmentConfig, PrepConfig, Stroke } from "./types";

type ModelFile = {
  n_features: number; n_strokes: number; stride: number; d_embed: number;
  features: string[];
  cfg: Record<string, number | boolean | null>;
  pcfg: Record<string, number | boolean | number[]>;
  thresholds: Record<string, number>;
  preprocess: Preprocessor;
  meta?: Record<string, unknown>;
  weights: Record<string, { shape: number[]; data: string }>;
};

const M = modelJson as unknown as ModelFile;

export const CONFIG = M.cfg as unknown as SegmentConfig;
export const PREP = M.pcfg as unknown as PrepConfig;
export const THRESHOLDS = M.thresholds;
export const META = M.meta ?? {};
export const PREPROCESSOR = M.preprocess;
/** Strokes per window, and how far the window slides between embeddings. */
export const N_STROKES = M.n_strokes;
export const STRIDE = M.stride;
export type OperatingPoint = "frr1" | "frr5" | "frr10" | "balanced" | "eer";

let _enc: WindowEncoder | null = null;
function encoder(): WindowEncoder {
  if (!_enc) _enc = new WindowEncoder(M);
  return _enc;
}

/** Embed pre-scaled windows directly. The live engine needs this because it
 * assembles windows from a rolling stroke buffer rather than from one session. */
export function embedWindows(windows: Float32Array[][]): Float32Array[] {
  return encoder().embed(windows);
}

/** Same validity gate as `strokes_to_frame` plus `filter_strokes`. */
function usableStrokes(strokes: Stroke[]): { stroke: Stroke; feat: FeatureRow }[] {
  const out: { stroke: Stroke; feat: FeatureRow }[] = [];
  for (const s of strokes) {
    if (s.t.length < CONFIG.min_points) continue;
    let pathLen = 0;
    for (let i = 1; i < s.x.length; i++)
      pathLen += Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
    if (pathLen < CONFIG.min_path_px) continue;
    if (s.t[s.t.length - 1] - s.t[0] < CONFIG.min_duration_s) continue;

    const feat = strokeFeatures(s, CONFIG);
    const vMax = feat.v_max, dur = feat.duration, vStd = feat.v_std, bbox = feat.bbox_area;
    if (vMax !== null && vMax > PREP.max_speed_px_s) continue;
    if (feat.path_len !== null && feat.path_len > PREP.max_path_px) continue;
    if (PREP.drop_zero_var_strokes && (vStd === 0 || bbox === 0)) continue;
    if (dur === null || !Number.isFinite(dur) || dur <= 0) continue;
    out.push({ stroke: s, feat });
  }
  return out;
}

/** Raw events -> one embedding per sliding window of `n_strokes`. */
export function embedSession(events: RawEvent[]): Float32Array[] {
  const ev = cleanEvents(events, PREP);
  const rows = usableStrokes(segmentStrokes(ev, CONFIG));
  const n = M.n_strokes;
  if (rows.length < n) {
    throw new Error(`only ${rows.length} usable strokes, need at least ${n}`);
  }
  const scaled = applyPreprocessor(rows.map((r) => r.feat), M.preprocess);
  const windows: Float32Array[][] = [];
  for (let end = n; end <= scaled.length; end += M.stride) {
    windows.push(scaled.slice(end - n, end));
  }
  return encoder().embed(windows);
}

function l2(v: Float32Array): Float32Array {
  let s = 0;
  for (const q of v) s += q * q;
  s = Math.sqrt(s);
  return s > 0 ? v.map((q) => q / s) : v;
}

function meanUnit(vs: Float32Array[]): Float32Array {
  const d = vs[0].length;
  const acc = new Float32Array(d);
  for (const v of vs) for (let i = 0; i < d; i++) acc[i] += v[i] / vs.length;
  return l2(acc);
}

export type Template = { vector: number[]; nWindows: number };

/** One or more recordings of one person -> a unit-norm template. */
export function enrol(sessions: RawEvent[] | RawEvent[][]): Template {
  const list = (Array.isArray(sessions[0]) ? sessions : [sessions]) as RawEvent[][];
  const zs = list.flatMap((s) => embedSession(s));
  return { vector: Array.from(meanUnit(zs)), nWindows: zs.length };
}

export type VerifyResult = {
  score: number;
  threshold: number;
  accept: boolean;
  operatingPoint: OperatingPoint;
  nWindows: number;
  perWindowScores: number[];
};

/** Is this recording the enrolled person? Returns the numbers behind the
 * decision, never a bare boolean - a verdict you cannot audit is a verdict you
 * cannot debug. */
export function verify(
  events: RawEvent[],
  template: Template,
  operatingPoint: OperatingPoint = "frr5",
): VerifyResult {
  const t = Float32Array.from(template.vector);
  const zs = embedSession(events);
  const s = meanUnit(zs);
  const dot = (a: Float32Array, b: Float32Array) =>
    a.reduce((acc, v, i) => acc + v * b[i], 0);
  const threshold = THRESHOLDS[operatingPoint];
  if (threshold === undefined) {
    throw new Error(`unknown operating point "${operatingPoint}"; have ${Object.keys(THRESHOLDS)}`);
  }
  const score = dot(s, t);
  return {
    score, threshold, accept: score >= threshold, operatingPoint,
    nWindows: zs.length,
    perWindowScores: zs.map((z) => dot(z, t)),
  };
}

/** Rank a recording against many enrolled templates. */
export function identify(
  events: RawEvent[],
  templates: Record<string, Template>,
): { user: string; score: number }[] {
  const s = meanUnit(embedSession(events));
  return Object.entries(templates)
    .map(([user, t]) => ({
      user,
      score: s.reduce((acc, v, i) => acc + v * t.vector[i], 0),
    }))
    .sort((a, b) => b.score - a.score);
}

export type { RawEvent } from "./types";
