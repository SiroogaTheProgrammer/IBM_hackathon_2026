/**
 * Port of `clean_events`, `pair_clicks` and `segment_strokes` from
 * `encoder2/deploy/mouse_auth.py`.
 *
 * Every step here exists because of something in the capture, not because of
 * anything about the user - see the Python docstrings for why each one is
 * there. The ordering matters and matches the original exactly: a different
 * order produces subtly different strokes and therefore different features.
 */
import {
  type RawEvent, type Stroke, type ClickPair, type SegmentConfig, type PrepConfig,
  MOVE_STATES, DOWN_STATES, UP_STATES,
} from "./types";

type CleanEvent = RawEvent & { isMove: boolean };

function median(a: number[]): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Isolated one-sample position jumps: out and immediately back. */
function despikeMask(x: number[], y: number[], jumpPx: number, ratio: number): boolean[] {
  const n = x.length;
  const bad = new Array<boolean>(n).fill(false);
  if (n < 3) return bad;
  for (let i = 1; i < n - 1; i++) {
    const a = Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
    const b = Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]);
    const c = Math.hypot(x[i + 1] - x[i - 1], y[i + 1] - y[i - 1]);
    if (a > jumpPx && b > jumpPx && c < ratio * (a + b)) bad[i] = true;
  }
  return bad;
}

export function cleanEvents(raw: RawEvent[], pcfg: PrepConfig): CleanEvent[] {
  let ev: CleanEvent[] = raw
    .map((e) => ({
      t: Number(e.t), x: Number(e.x), y: Number(e.y),
      button: String(e.button ?? "nobutton").trim().toLowerCase(),
      state: String(e.state ?? "").trim().toLowerCase(),
      isMove: false,
    }))
    .filter((e) => Number.isFinite(e.t) && Number.isFinite(e.x) && Number.isFinite(e.y));

  if (pcfg.drop_scroll) {
    ev = ev.filter((e) => !e.button.includes("scroll") && !e.state.includes("scroll"));
  }
  ev = ev.filter(
    (e) => e.x >= pcfg.x_range[0] && e.x <= pcfg.x_range[1] &&
           e.y >= pcfg.y_range[0] && e.y <= pcfg.y_range[1],
  );

  // rows where the clock steps backwards: dropped, not re-sorted. Sorting them
  // into place reorders real motion, which is worse than losing them.
  if (pcfg.drop_out_of_order && ev.length) {
    let run = -Infinity;
    ev = ev.filter((e) => {
      run = Math.max(run, e.t);
      return e.t >= run - 1e-9;
    });
  }

  // stable sort by t (Array.prototype.sort is stable in ES2019+), matching
  // pandas' kind="mergesort"
  ev = ev.map((e, i) => ({ e, i }))
    .sort((p, q) => (p.e.t - q.e.t) || (p.i - q.i))
    .map(({ e }) => e);
  ev.forEach((e) => { e.isMove = MOVE_STATES.has(e.state); });

  // Tied timestamps among MOVES only, keep the last of each tied group
  // (pandas: moves.drop_duplicates(subset="t", keep="last")). Button events are
  // never dropped. The re-sort then places moves BEFORE others at equal t,
  // because the original concatenates [moves, others] and sorts stably - and
  // that ordering decides whether a click counts as "before" a move sample.
  const lastMoveAt = new Map<number, CleanEvent>();
  for (const e of ev) if (e.isMove) lastMoveAt.set(e.t, e);
  const keptMoves = new Set<CleanEvent>(lastMoveAt.values());
  const movesKept = ev.filter((e) => e.isMove && keptMoves.has(e));
  const otherEvents = ev.filter((e) => !e.isMove);
  ev = [...movesKept, ...otherEvents]
    .map((e, i) => ({ e, i }))
    .sort((p, q) => (p.e.t - q.e.t) || (p.i - q.i))
    .map(({ e }) => e);

  if (pcfg.despike) {
    const mv = ev.filter((e) => e.isMove);
    const bad = despikeMask(mv.map((e) => e.x), mv.map((e) => e.y),
                            pcfg.despike_px, pcfg.despike_ratio);
    const drop = new Set<CleanEvent>();
    mv.forEach((e, i) => { if (bad[i]) drop.add(e); });
    ev = ev.filter((e) => !drop.has(e));
  }
  return ev;
}

export function pairClicks(ev: CleanEvent[]): ClickPair[] {
  const open = new Map<string, CleanEvent>();
  const out: ClickPair[] = [];
  for (const r of ev) {
    if (DOWN_STATES.has(r.state)) open.set(r.button, r);
    else if (UP_STATES.has(r.state) && open.has(r.button)) {
      const p = open.get(r.button)!;
      open.delete(r.button);
      out.push({ tDown: p.t, tUp: r.t, dwell: r.t - p.t, button: r.button, cx: p.x, cy: p.y });
    }
  }
  return out;
}

export function segmentStrokes(ev: CleanEvent[], cfg: SegmentConfig): Stroke[] {
  const mv = ev.filter((e) => e.isMove);
  if (mv.length < 2) return [];

  const t = mv.map((e) => e.t), x = mv.map((e) => e.x), y = mv.map((e) => e.y);
  const isDrag = mv.map((e) => e.state === "drag");

  let thr = cfg.pause_split_s;
  if (cfg.adaptive_pause) {
    const d: number[] = [];
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] > 0) d.push(t[i] - t[i - 1]);
    if (d.length) thr = Math.max(thr, cfg.adaptive_pause_mult * median(d));
  }

  // how many click events have happened before each move sample
  const clickCum: number[] = [];
  let c = 0;
  for (const e of ev) {
    if (DOWN_STATES.has(e.state) || UP_STATES.has(e.state)) c++;
    if (e.isMove) clickCum.push(c);
  }

  const brk = new Array<boolean>(t.length).fill(false);
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt > thr || dt <= 0) brk[i] = true;
    if (isDrag[i] !== isDrag[i - 1]) brk[i] = true;
    if (cfg.split_on_click && clickCum[i] - clickCum[i - 1] > 0) brk[i] = true;
  }

  const groups: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (brk[i] && cur.length) { groups.push(cur); cur = []; }
    cur.push(i);
  }
  if (cur.length) groups.push(cur);

  const clicks = pairClicks(ev);
  const out: Stroke[] = [];
  for (const g of groups) {
    const pieces: number[][] = [];
    if (g.length > cfg.max_points) {
      for (let i = 0; i < g.length; i += cfg.max_points) pieces.push(g.slice(i, i + cfg.max_points));
    } else pieces.push(g);

    for (const p of pieces) {
      if (p.length < 2) continue;
      let tt = p.map((i) => t[i]), xx = p.map((i) => x[i]), yy = p.map((i) => y[i]);
      if (tt[tt.length - 1] - tt[0] > cfg.max_duration_s) {
        const keep = tt.map((v) => v - tt[0] <= cfg.max_duration_s);
        tt = tt.filter((_, i) => keep[i]);
        xx = xx.filter((_, i) => keep[i]);
        yy = yy.filter((_, i) => keep[i]);
        if (tt.length < 2) continue;
      }
      const end = tt[tt.length - 1];
      const click = clicks.find((k) => k.tDown >= end - 1e-9 && k.tDown <= end + 1.0) ?? null;
      out.push({ t: tt, x: xx, y: yy, isDrag: isDrag[p[0]], click });
    }
  }
  return out;
}
