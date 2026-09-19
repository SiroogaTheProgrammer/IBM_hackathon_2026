/**
 * Port of `stroke_features` from `encoder2/deploy/mouse_auth.py`.
 *
 * NaN is represented as `null` and handled by the preprocessor's fill step,
 * exactly as pandas handles it. Several features are *structurally* NaN rather
 * than missing - `click_dwell` when no click terminated the stroke - and the
 * preprocessor fills those with 0 rather than a median, because inventing a
 * dwell time for a click that never happened is worse than saying "none".
 *
 * Verified against the Python implementation by `scripts/sapimouseParity.ts`.
 */
import type { Stroke, SegmentConfig } from "./types";

export type FeatureRow = Record<string, number | null>;

const NA = null;

function safeDiv(a: number[], b: number[], fill = 0): number[] {
  return a.map((v, i) => (Math.abs(b[i]) > 1e-12 ? v / b[i] : fill));
}

function wrapPi(a: number): number {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

function diff(a: number[]): number[] {
  const o: number[] = [];
  for (let i = 1; i < a.length; i++) o.push(a[i] - a[i - 1]);
  return o;
}

const sum = (a: number[]) => a.reduce((p, q) => p + q, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);

/** Population standard deviation (numpy ddof=0). */
function std(a: number[]): number {
  if (!a.length) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / a.length);
}

/** numpy.percentile default: linear interpolation between order statistics. */
function percentile(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** Port of `_stats`: mean/std/min/max/p25/p50/p75, NaN-filtered first. */
function stats(prefix: string, arr: number[], out: FeatureRow): void {
  const a = arr.filter((v) => Number.isFinite(v));
  const keys = ["mean", "std", "min", "max", "p25", "p50", "p75"];
  if (!a.length) {
    for (const k of keys) out[`${prefix}_${k}`] = NA;
    return;
  }
  out[`${prefix}_mean`] = mean(a);
  out[`${prefix}_std`] = std(a);
  out[`${prefix}_min`] = Math.min(...a);
  out[`${prefix}_max`] = Math.max(...a);
  out[`${prefix}_p25`] = percentile(a, 25);
  out[`${prefix}_p50`] = percentile(a, 50);
  out[`${prefix}_p75`] = percentile(a, 75);
}

/** Replace invalid entries with the last valid one (numpy `_ffill_invalid`). */
function ffillInvalid(values: number[], valid: boolean[]): number[] {
  if (!valid.some(Boolean)) return values.map(() => 0);
  const idx: number[] = [];
  let run = 0;
  for (let i = 0; i < values.length; i++) {
    if (valid[i]) run = i;
    idx.push(run);
  }
  // numpy takes maximum.accumulate over where(valid, arange, 0), so leading
  // invalid entries resolve to index 0 rather than to the first valid one
  return idx.map((i) => values[i]);
}

export function strokeFeatures(s: Stroke, cfg: SegmentConfig): FeatureRow {
  const { t, x, y, click } = s;
  const n = t.length;
  const f: FeatureRow = {};

  const dt = diff(t), dx = diff(x), dy = diff(y);
  const seg = dx.map((v, i) => Math.hypot(v, dy[i]));
  const v = safeDiv(seg, dt);

  const duration = t[n - 1] - t[0];
  const path = sum(seg);
  const disp = Math.hypot(x[n - 1] - x[0], y[n - 1] - y[0]);

  // --- shape ---------------------------------------------------------------
  f.n_points = n;
  f.duration = duration;
  f.path_len = path;
  f.displacement = disp;
  f.straightness = path > 0 ? disp / path : 0;

  const bw = Math.max(...x) - Math.min(...x);
  const bh = Math.max(...y) - Math.min(...y);
  f.bbox_w = bw; f.bbox_h = bh; f.bbox_area = bw * bh;
  f.bbox_aspect = Math.log1p(bw) - Math.log1p(bh);
  const ang = Math.atan2(y[n - 1] - y[0], x[n - 1] - x[0]);
  f.angle_start_end = ang;
  f.dir_sin = Math.sin(ang);
  f.dir_cos = Math.cos(ang);

  if (disp > 1e-9) {
    const ux = (x[n - 1] - x[0]) / disp, uy = (y[n - 1] - y[0]) / disp;
    const perp = x.map((xi, i) => Math.abs((xi - x[0]) * -uy + (y[i] - y[0]) * ux));
    f.dev_mean = mean(perp);
    f.dev_max = Math.max(...perp);
    f.dev_max_norm = Math.max(...perp) / disp;
  } else {
    f.dev_mean = 0; f.dev_max = 0; f.dev_max_norm = 0;
  }

  // --- speed ---------------------------------------------------------------
  stats("v", v, f);
  f.v_cv = f.v_mean ? (f.v_std as number) / (f.v_mean as number) : NA;
  const tm: number[] = [];
  for (let i = 1; i < n; i++) tm.push(0.5 * (t[i] + t[i - 1]));
  if (v.length) {
    let am = 0;
    for (let i = 1; i < v.length; i++) if (v[i] > v[am]) am = i;
    f.t_peak_frac = duration > 0 ? (tm[am] - t[0]) / duration : NA;
    f.v_terminal = v[v.length - 1];
    f.v_initial = v[0];
  } else {
    f.t_peak_frac = NA; f.v_terminal = NA; f.v_initial = NA;
  }

  // --- acceleration / jerk -------------------------------------------------
  let a: number[] = [];
  if (n >= 3) {
    a = safeDiv(diff(v), diff(tm));
    stats("a", a, f);
    f.a_abs_mean = mean(a.map(Math.abs));
    f.accel_frac = mean(a.map((q) => (q > 0 ? 1 : 0)));
  } else {
    stats("a", [], f);
    f.a_abs_mean = NA; f.accel_frac = NA;
  }

  if (n >= 4) {
    const tj: number[] = [];
    for (let i = 1; i < tm.length; i++) tj.push(0.5 * (tm[i] + tm[i - 1]));
    const j = safeDiv(diff(a), diff(tj));
    f.j_abs_mean = mean(j.map(Math.abs));
    f.j_abs_max = Math.max(...j.map(Math.abs));
    f.j_std = std(j);
  } else {
    f.j_abs_mean = NA; f.j_abs_max = NA; f.j_std = NA;
  }

  // --- angular -------------------------------------------------------------
  const thRaw = dx.map((v2, i) => Math.atan2(dy[i], v2));
  const th = ffillInvalid(thRaw, seg.map((q) => q > 1e-12));
  if (th.length >= 2) {
    const dth = diff(th).map(wrapPi);
    const angv = safeDiv(dth, diff(tm));
    const segMid: number[] = [];
    for (let i = 1; i < seg.length; i++) segMid.push(0.5 * (seg[i] + seg[i - 1]));
    const curv = safeDiv(dth, segMid);
    const absDth = dth.map(Math.abs);
    f.angle_abs_sum = sum(absDth);
    f.angle_abs_mean = mean(absDth);
    f.angv_abs_mean = mean(angv.map(Math.abs));
    f.angv_abs_max = Math.max(...angv.map(Math.abs));
    f.curv_abs_mean = mean(curv.map(Math.abs));
    f.curv_abs_max = Math.max(...curv.map(Math.abs));
    f.curv_std = std(curv);
    const nd = absDth.filter((q) => q > (cfg.dir_change_deg * Math.PI) / 180).length;
    f.n_dir_changes = nd;
    f.dir_change_rate = duration > 0 ? nd / duration : NA;
  } else {
    for (const k of ["angle_abs_sum", "angle_abs_mean", "angv_abs_mean", "angv_abs_max",
                     "curv_abs_mean", "curv_abs_max", "curv_std", "n_dir_changes",
                     "dir_change_rate"]) f[k] = NA;
  }

  // --- sampling / rhythm ---------------------------------------------------
  f.dt_mean = mean(dt);
  f.dt_std = std(dt);
  f.dt_cv = f.dt_mean ? (f.dt_std as number) / (f.dt_mean as number) : NA;
  const micro = seg.map((q) => q < cfg.stationary_px);
  f.n_micro_pauses = micro.filter(Boolean).length;
  f.micro_pause_frac = duration > 0 ? sum(dt.filter((_, i) => micro[i])) / duration : NA;

  // --- final approach ------------------------------------------------------
  const tail = duration > 0
    ? tm.map((q) => q >= t[n - 1] - cfg.tail_frac * duration)
    : tm.map(() => false);
  if (tail.some(Boolean)) {
    const vt = v.filter((_, i) => tail[i]);
    f.tail_v_mean = mean(vt);
    f.tail_v_max = Math.max(...vt);
    f.tail_path_frac = path > 0 ? sum(seg.filter((_, i) => tail[i])) / path : NA;
  } else {
    f.tail_v_mean = NA; f.tail_v_max = NA; f.tail_path_frac = NA;
  }

  // --- click ---------------------------------------------------------------
  if (click) {
    const d = x.map((xi, i) => Math.hypot(xi - click.cx, y[i] - click.cy));
    let mi = 0;
    for (let i = 1; i < d.length; i++) if (d[i] < d[mi]) mi = i;
    f.click_dwell = click.dwell;
    f.click_delay = click.tDown - t[n - 1];
    f.click_dist_end = Math.hypot(x[n - 1] - click.cx, y[n - 1] - click.cy);
    f.overshoot_path = sum(seg.slice(mi));
    f.overshoot_max = Math.max(...d.slice(mi));
  } else {
    for (const k of ["click_dwell", "click_delay", "click_dist_end",
                     "overshoot_path", "overshoot_max"]) f[k] = NA;
  }

  // inf -> NaN, matching strokes_to_frame's replace([inf, -inf], nan)
  for (const k of Object.keys(f)) {
    const val = f[k];
    if (val !== null && !Number.isFinite(val)) f[k] = NA;
  }
  return f;
}
