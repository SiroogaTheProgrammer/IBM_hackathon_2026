"""Mouse-dynamics verification: enrol a person from one recording, verify from another.

Generated from sapimouse_features.ipynb -- the pipeline, encoder and preprocessor
here are byte-identical to the ones the reported numbers were measured with, so a
deployed decision and a benchmarked decision cannot drift apart.

    from mouse_auth import MouseAuth
    auth = MouseAuth.load("data/models/sapimouse_deploy")
    tmpl = auth.enrol("alice_enrol.csv")
    print(auth.verify("unknown.csv", tmpl))
"""

from __future__ import annotations

import json
import warnings
from dataclasses import dataclass, asdict, field, replace
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import joblib

if torch.cuda.is_available():
    DEVICE = "cuda"
elif torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"


# ---------------------------------------------------------------------------
# SapiMouse loader
# ---------------------------------------------------------------------------
# Three differences from Balabit that will silently corrupt everything if missed:
#
#   1. `client timestamp` is in MILLISECONDS, not seconds. Left unconverted every
#      dt is 1000x too large, every velocity 1000x too small, and the adaptive
#      pause threshold puts each sample in its own stroke.
#   2. There is no `record timestamp` column at all.
#   3. Sessions are fixed-length takes (1 min and 3 min) rather than whatever the
#      user happened to do, so session length carries no information about the
#      person -- which is a good thing, and one less confound than Balabit had.

TIME_UNIT_S = 1e-3          # client timestamp -> seconds

DTYPES = {
    "client timestamp": "float64",
    "button": "category",
    "state": "category",
    "x": "float32",
    "y": "float32",
}


def load_session(path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=DTYPES)
    df.columns = [c.strip().lower() for c in df.columns]
    df["client timestamp"] = df["client timestamp"].astype("float64") * TIME_UNIT_S
    return df



import warnings
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------


@dataclass
class Config:
    # --- which clock to trust -------------------------------------------------
    time_col: str = "client timestamp"   # or "record timestamp"

    # --- stroke segmentation --------------------------------------------------
    pause_split_s: float = 0.50          # gap that ends a stroke
    adaptive_pause: bool = True          # override with k * median(dt) if larger
    adaptive_pause_mult: float = 4.0
    split_on_click: bool = True          # a click always terminates a stroke
    max_duration_s: float = 10.0         # hard cap so one stroke can't run away
    max_points: int = 300

    # --- stroke validity ------------------------------------------------------
    min_points: int = 6
    min_path_px: float = 20.0
    min_duration_s: float = 0.05

    # --- feature knobs --------------------------------------------------------
    dir_change_deg: float = 20.0         # angle change that counts as a reversal
    stationary_px: float = 2.0           # segment shorter than this == micro-pause
    tail_frac: float = 0.25              # "final approach" = last 25% of the stroke

    # --- normalisation --------------------------------------------------------
    screen_w: float | None = None        # e.g. 1920 -> positions/lengths in screen units
    screen_h: float | None = None

    # --- misc -----------------------------------------------------------------
    verbose: bool = True


MOVE_STATES = {"move", "drag"}
DOWN_STATES = {"pressed", "down"}
UP_STATES = {"released", "up"}


# ----------------------------------------------------------------------------
# small numeric helpers
# ----------------------------------------------------------------------------


def _safe_div(a, b, fill=0.0):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    out = np.full(a.shape, fill, dtype=float)
    m = np.abs(b) > 1e-12
    out[m] = a[m] / b[m]
    return out


def _wrap(a):
    """Wrap angles to (-pi, pi]."""
    return (np.asarray(a) + np.pi) % (2 * np.pi) - np.pi


def _ffill_invalid(values, valid):
    """Replace invalid entries with the last valid one (vectorised)."""
    values = np.asarray(values, dtype=float)
    valid = np.asarray(valid, dtype=bool)
    if not valid.any():
        return np.zeros_like(values)
    idx = np.where(valid, np.arange(len(values)), 0)
    idx = np.maximum.accumulate(idx)
    return values[idx]


def _stats(prefix, arr, pcts=(25, 50, 75)):
    """mean/std/min/max/percentiles of an array, as a flat dict."""
    out = {}
    arr = np.asarray(arr, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        keys = ["mean", "std", "min", "max"] + [f"p{p}" for p in pcts]
        return {f"{prefix}_{k}": np.nan for k in keys}
    out[f"{prefix}_mean"] = float(arr.mean())
    out[f"{prefix}_std"] = float(arr.std(ddof=0))
    out[f"{prefix}_min"] = float(arr.min())
    out[f"{prefix}_max"] = float(arr.max())
    for p, q in zip(pcts, np.percentile(arr, pcts)):
        out[f"{prefix}_p{p}"] = float(q)
    return out


# ----------------------------------------------------------------------------
# 1. load
# ----------------------------------------------------------------------------


def load_events(path, cfg: Config = Config()) -> pd.DataFrame:
    """Read a raw log and return a clean frame with columns t, x, y, state, button, is_move."""
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]

    tcol = cfg.time_col.strip().lower()
    if tcol not in df.columns:
        raise KeyError(f"time column {tcol!r} not in {list(df.columns)}")
    for c in ("x", "y", "state"):
        if c not in df.columns:
            raise KeyError(f"expected column {c!r} in {list(df.columns)}")

    out = pd.DataFrame(
        {
            "t": pd.to_numeric(df[tcol], errors="coerce"),
            "x": pd.to_numeric(df["x"], errors="coerce"),
            "y": pd.to_numeric(df["y"], errors="coerce"),
            "state": df["state"].astype(str).str.strip().str.lower(),
            "button": df.get("button", "NoButton").astype(str).str.strip().str.lower(),
        }
    ).dropna(subset=["t", "x", "y"])

    # Balabit sometimes parks the cursor at absurd coordinates on session start/end
    out = out[(out.x.between(-1e4, 1e5)) & (out.y.between(-1e4, 1e5))]

    out = out.sort_values("t", kind="mergesort").reset_index(drop=True)
    out["is_move"] = out.state.isin(MOVE_STATES)

    # Ties: several move samples share one timestamp (event coalescing in the log).
    # Keep the LAST position of each tied group; never drop button events.
    moves = out[out.is_move].drop_duplicates(subset="t", keep="last")
    others = out[~out.is_move]
    out = (
        pd.concat([moves, others])
        .sort_values(["t"], kind="mergesort")
        .reset_index(drop=True)
    )

    if cfg.screen_w:
        out["x"] = out["x"] / cfg.screen_w
    if cfg.screen_h:
        out["y"] = out["y"] / cfg.screen_h

    return out


def diagnose(events: pd.DataFrame, cfg: Config = Config()) -> dict:
    """Sampling-rate report. Run this once per dataset before trusting any derivative."""
    mv = events[events.is_move]
    dt = np.diff(mv.t.values)
    dt = dt[dt > 0]
    d = {
        "n_events": len(events),
        "n_moves": len(mv),
        "n_clicks": int(events.state.isin(DOWN_STATES).sum()),
        "duration_s": float(events.t.max() - events.t.min()) if len(events) else 0.0,
        "dt_median": float(np.median(dt)) if dt.size else np.nan,
        "dt_p90": float(np.percentile(dt, 90)) if dt.size else np.nan,
        "sample_rate_hz": float(1.0 / np.median(dt)) if dt.size else np.nan,
    }
    if cfg.verbose:
        print(
            f"[diagnose] {d['n_moves']} moves, {d['n_clicks']} clicks, "
            f"{d['duration_s']:.0f}s, median dt={d['dt_median']*1000:.0f}ms "
            f"(~{d['sample_rate_hz']:.0f} Hz)"
        )
        if d["sample_rate_hz"] < 30:
            print(
                "  ! low sampling rate: jerk and spectral features will be mostly "
                "quantisation noise. Trust speed/geometry/timing features instead."
            )
        if cfg.pause_split_s < 3 * d["dt_median"]:
            print(
                f"  ! pause_split_s={cfg.pause_split_s}s is close to the sampling "
                f"interval; almost every sample would start a new stroke."
            )
    return d


# ----------------------------------------------------------------------------
# 2. click pairing
# ----------------------------------------------------------------------------


def pair_clicks(events: pd.DataFrame) -> pd.DataFrame:
    """Match each press to the next release of the same button -> dwell time."""
    ev = events[events.state.isin(DOWN_STATES | UP_STATES)]
    rows, open_press = [], {}
    for r in ev.itertuples():
        if r.state in DOWN_STATES:
            open_press[r.button] = r
        elif r.state in UP_STATES and r.button in open_press:
            p = open_press.pop(r.button)
            rows.append(
                {
                    "t_down": p.t,
                    "t_up": r.t,
                    "dwell": r.t - p.t,
                    "button": r.button,
                    "cx": p.x,
                    "cy": p.y,
                }
            )
    return pd.DataFrame(rows, columns=["t_down", "t_up", "dwell", "button", "cx", "cy"])


# ----------------------------------------------------------------------------
# 3. segmentation
# ----------------------------------------------------------------------------


def segment_strokes(events: pd.DataFrame, cfg: Config = Config()):
    """Cut the move stream into strokes. Returns a list of (t, x, y, is_drag, click_row_or_None)."""
    mv = events[events.is_move].reset_index(drop=True)
    if len(mv) < 2:
        return []

    thr = cfg.pause_split_s
    if cfg.adaptive_pause:
        dt_all = np.diff(mv.t.values)
        dt_all = dt_all[dt_all > 0]
        if dt_all.size:
            thr = max(thr, cfg.adaptive_pause_mult * float(np.median(dt_all)))

    t = mv.t.values.astype(float)
    x = mv.x.values.astype(float)
    y = mv.y.values.astype(float)
    is_drag = (mv.state == "drag").values

    # how many click events have happened before each move sample
    click_cum = events.state.isin(DOWN_STATES | UP_STATES).cumsum()
    click_cum_mv = click_cum[events.is_move.values].values

    dt = np.diff(t)
    brk = np.zeros(len(t), dtype=bool)
    brk[1:] |= dt > thr                       # pause
    brk[1:] |= dt <= 0                        # clock glitch
    brk[1:] |= is_drag[1:] != is_drag[:-1]    # drag <-> free move
    if cfg.split_on_click:
        brk[1:] |= np.diff(click_cum_mv) > 0  # a click happened in between

    sid = np.cumsum(brk)

    clicks = pair_clicks(events)
    strokes = []
    for _, idx in pd.Series(np.arange(len(t))).groupby(sid):
        idx = idx.values
        # hard caps: chop over-long strokes into pieces
        pieces = [idx]
        if len(idx) > cfg.max_points:
            pieces = [
                idx[i : i + cfg.max_points] for i in range(0, len(idx), cfg.max_points)
            ]
        for p in pieces:
            if len(p) < 2:
                continue
            tt, xx, yy = t[p], x[p], y[p]
            if tt[-1] - tt[0] > cfg.max_duration_s:
                keep = tt - tt[0] <= cfg.max_duration_s
                tt, xx, yy = tt[keep], xx[keep], yy[keep]
                if len(tt) < 2:
                    continue
            # click that terminates this stroke, if any (press within 1s after the end)
            click = None
            if len(clicks):
                cand = clicks[(clicks.t_down >= tt[-1] - 1e-9) & (clicks.t_down <= tt[-1] + 1.0)]
                if len(cand):
                    click = cand.iloc[0]
            strokes.append((tt, xx, yy, bool(is_drag[p[0]]), click))
    return strokes


# ----------------------------------------------------------------------------
# 4. per-stroke features
# ----------------------------------------------------------------------------


def stroke_features(t, x, y, is_drag=False, click=None, cfg: Config = Config()) -> dict:
    n = len(t)
    f: dict = {}

    dt = np.diff(t)
    dx, dy = np.diff(x), np.diff(y)
    seg = np.hypot(dx, dy)
    v = _safe_div(seg, dt)

    duration = float(t[-1] - t[0])
    path = float(seg.sum())
    disp = float(np.hypot(x[-1] - x[0], y[-1] - y[0]))

    # --- shape ---------------------------------------------------------------
    f["n_points"] = n
    f["duration"] = duration
    f["path_len"] = path
    f["displacement"] = disp
    f["straightness"] = disp / path if path > 0 else 0.0
    f["is_drag"] = int(is_drag)

    bw, bh = float(x.max() - x.min()), float(y.max() - y.min())
    f["bbox_w"], f["bbox_h"] = bw, bh
    f["bbox_area"] = bw * bh
    f["bbox_aspect"] = np.log1p(bw) - np.log1p(bh)          # symmetric, no div-by-zero
    f["angle_start_end"] = float(np.arctan2(y[-1] - y[0], x[-1] - x[0]))
    f["dir_sin"] = float(np.sin(f["angle_start_end"]))      # layout-invariant direction
    f["dir_cos"] = float(np.cos(f["angle_start_end"]))

    # deviation from the straight start->end line ("how bowed is the path")
    if disp > 1e-9:
        ux, uy = (x[-1] - x[0]) / disp, (y[-1] - y[0]) / disp
        perp = np.abs((x - x[0]) * (-uy) + (y - y[0]) * ux)
        f["dev_mean"] = float(perp.mean())
        f["dev_max"] = float(perp.max())
        f["dev_max_norm"] = float(perp.max() / disp)
    else:
        f["dev_mean"] = f["dev_max"] = f["dev_max_norm"] = 0.0

    # --- speed ---------------------------------------------------------------
    f.update(_stats("v", v))
    f["v_cv"] = f["v_std"] / f["v_mean"] if f["v_mean"] else np.nan
    tm = 0.5 * (t[1:] + t[:-1])                              # midpoint times for v
    if v.size:
        f["t_peak_frac"] = float((tm[int(np.argmax(v))] - t[0]) / duration) if duration > 0 else np.nan
        f["v_terminal"] = float(v[-1])
        f["v_initial"] = float(v[0])
    else:
        f["t_peak_frac"] = f["v_terminal"] = f["v_initial"] = np.nan

    # --- acceleration / jerk (weak at low sample rates -- see diagnose()) -----
    if n >= 3:
        a = _safe_div(np.diff(v), np.diff(tm))
        f.update(_stats("a", a))
        f["a_abs_mean"] = float(np.abs(a).mean())
        f["accel_frac"] = float((a > 0).mean())              # share of time speeding up
    else:
        f.update(_stats("a", np.array([])))
        f["a_abs_mean"] = f["accel_frac"] = np.nan

    if n >= 4:
        tj = 0.5 * (tm[1:] + tm[:-1])
        j = _safe_div(np.diff(a), np.diff(tj))
        f["j_abs_mean"] = float(np.abs(j).mean())
        f["j_abs_max"] = float(np.abs(j).max())
        f["j_std"] = float(j.std(ddof=0))
    else:
        f["j_abs_mean"] = f["j_abs_max"] = f["j_std"] = np.nan

    # --- angular ------------------------------------------------------------
    th = _ffill_invalid(np.arctan2(dy, dx), seg > 1e-12)
    if th.size >= 2:
        dth = _wrap(np.diff(th))
        angv = _safe_div(dth, np.diff(tm))
        curv = _safe_div(dth, 0.5 * (seg[1:] + seg[:-1]))
        f["angle_abs_sum"] = float(np.abs(dth).sum())
        f["angle_abs_mean"] = float(np.abs(dth).mean())
        f["angv_abs_mean"] = float(np.abs(angv).mean())
        f["angv_abs_max"] = float(np.abs(angv).max())
        f["curv_abs_mean"] = float(np.abs(curv).mean())
        f["curv_abs_max"] = float(np.abs(curv).max())
        f["curv_std"] = float(curv.std(ddof=0))
        nd = int((np.abs(dth) > np.deg2rad(cfg.dir_change_deg)).sum())
        f["n_dir_changes"] = nd
        f["dir_change_rate"] = nd / duration if duration > 0 else np.nan
    else:
        for k in (
            "angle_abs_sum angle_abs_mean angv_abs_mean angv_abs_max "
            "curv_abs_mean curv_abs_max curv_std n_dir_changes dir_change_rate"
        ).split():
            f[k] = np.nan

    # --- sampling / rhythm ---------------------------------------------------
    f["dt_mean"] = float(dt.mean())
    f["dt_std"] = float(dt.std(ddof=0))
    f["dt_cv"] = f["dt_std"] / f["dt_mean"] if f["dt_mean"] else np.nan
    micro = seg < cfg.stationary_px
    f["n_micro_pauses"] = int(micro.sum())
    f["micro_pause_frac"] = float(dt[micro].sum() / duration) if duration > 0 else np.nan

    # --- final approach (the part that discriminates most, per the literature) -
    tail = tm >= (t[-1] - cfg.tail_frac * duration) if duration > 0 else np.zeros_like(tm, bool)
    if tail.any():
        f["tail_v_mean"] = float(v[tail].mean())
        f["tail_v_max"] = float(v[tail].max())
        f["tail_path_frac"] = float(seg[tail].sum() / path) if path > 0 else np.nan
    else:
        f["tail_v_mean"] = f["tail_v_max"] = f["tail_path_frac"] = np.nan

    # --- click ---------------------------------------------------------------
    if click is not None:
        cx, cy = float(click.cx), float(click.cy)
        d = np.hypot(x - cx, y - cy)
        i = int(np.argmin(d))
        f["has_click"] = 1
        f["click_dwell"] = float(click.dwell)
        f["click_button_left"] = int(str(click.button).startswith("left"))
        f["click_delay"] = float(click.t_down - t[-1])       # move end -> press
        f["click_dist_end"] = float(np.hypot(x[-1] - cx, y[-1] - cy))
        f["overshoot_path"] = float(seg[i:].sum())           # path travelled after closest approach
        f["overshoot_max"] = float(d[i:].max())
    else:
        for k in (
            "has_click click_dwell click_button_left click_delay "
            "click_dist_end overshoot_path overshoot_max"
        ).split():
            f[k] = 0 if k == "has_click" else np.nan

    return f


# ----------------------------------------------------------------------------
# 5. file / directory drivers
# ----------------------------------------------------------------------------


def strokes_to_frame(strokes, cfg: Config = Config()) -> pd.DataFrame:
    rows, dropped = [], {"short": 0, "tiny_path": 0, "brief": 0}
    for k, (t, x, y, is_drag, click) in enumerate(strokes):
        if len(t) < cfg.min_points:
            dropped["short"] += 1
            continue
        if float(np.hypot(np.diff(x), np.diff(y)).sum()) < cfg.min_path_px:
            dropped["tiny_path"] += 1
            continue
        if t[-1] - t[0] < cfg.min_duration_s:
            dropped["brief"] += 1
            continue
        f = stroke_features(t, x, y, is_drag, click, cfg)
        f["stroke_id"] = k
        f["t_start"] = float(t[0])
        f["t_end"] = float(t[-1])
        rows.append(f)

    if cfg.verbose:
        print(
            f"[strokes] kept {len(rows)} / {len(strokes)} "
            f"(dropped: {dropped['short']} too few points, "
            f"{dropped['tiny_path']} too short, {dropped['brief']} too brief)"
        )
    df = pd.DataFrame(rows)
    return df.replace([np.inf, -np.inf], np.nan)


def process_file(path, cfg: Config = Config(), user=None, session=None) -> pd.DataFrame:
    ev = load_events(path, cfg)
    if cfg.verbose:
        diagnose(ev, cfg)
    df = strokes_to_frame(segment_strokes(ev, cfg), cfg)
    if len(df):
        df.insert(0, "session", session or Path(path).name)
        df.insert(0, "user", user or Path(path).parent.name)
    return df


def process_dir(root, cfg: Config = Config(), pattern="**/session_*") -> pd.DataFrame:
    """Walk a Balabit-style tree (root/userN/session_xxxx) into one long frame."""
    root = Path(root)
    out = []
    for p in sorted(root.glob(pattern)):
        if not p.is_file():
            continue
        try:
            d = process_file(p, cfg, user=p.parent.name, session=p.name)
            if len(d):
                out.append(d)
        except Exception as e:  # keep going -- some session files are truncated
            warnings.warn(f"{p}: {e}")
    if not out:
        return pd.DataFrame()
    df = pd.concat(out, ignore_index=True)
    if cfg.verbose:
        print(f"[process_dir] {len(df)} strokes from {df.user.nunique()} users")
    return df


# ----------------------------------------------------------------------------
# 6. optional: strokes -> model input windows
# ----------------------------------------------------------------------------


NON_FEATURE = {"user", "session", "stroke_id", "t_start", "t_end"}


def strokes_to_windows(
    df: pd.DataFrame,
    n: int = 25,
    stride: int = 5,
    min_strokes: int = 8,
    max_span_s: float = 60.0,
    aggs=("mean", "std", "p25", "p50", "p75"),
) -> pd.DataFrame:
    """Sliding window over strokes -> one wide vector per window.

    Windows spanning more than max_span_s are dropped (the user walked away).
    Windows with fewer than min_strokes are never emitted (idle reading).
    """
    feat_cols = [c for c in df.columns if c not in NON_FEATURE]
    rows = []
    for (u, s), g in df.groupby(["user", "session"], sort=False):
        g = g.sort_values("t_start").reset_index(drop=True)
        vals = g[feat_cols].to_numpy(dtype=float)
        for end in range(n, len(g) + 1, stride):
            start = end - n
            if end - start < min_strokes:
                continue
            span = g.t_end.iloc[end - 1] - g.t_start.iloc[start]
            if span > max_span_s:
                continue
            blk = vals[start:end]
            rec = {"user": u, "session": s,
                   "t_start": float(g.t_start.iloc[start]),
                   "t_end": float(g.t_end.iloc[end - 1]),
                   "n_strokes": end - start, "span_s": float(span)}
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                for agg in aggs:
                    if agg == "mean":
                        vv = np.nanmean(blk, axis=0)
                    elif agg == "std":
                        vv = np.nanstd(blk, axis=0)
                    else:
                        vv = np.nanpercentile(blk, int(agg[1:]), axis=0)
                    for c, val in zip(feat_cols, vv):
                        rec[f"{c}_{agg}"] = float(val)
            rows.append(rec)
    out = pd.DataFrame(rows).replace([np.inf, -np.inf], np.nan)
    print(f"[windows] {len(out)} windows x {len([c for c in out.columns if c not in NON_FEATURE | {'n_strokes','span_s'}])} features")
    return out


# ----------------------------------------------------------------------------


from dataclasses import dataclass, asdict, replace
import numpy as np, pandas as pd, warnings, json, time

@dataclass
class PrepConfig:
    # --- event level ---
    x_range: tuple = (-2000.0, 8000.0)
    y_range: tuple = (-2000.0, 5000.0)
    drop_scroll: bool = True
    drop_out_of_order: bool = True
    despike: bool = True
    despike_px: float = 250.0
    despike_ratio: float = 0.35
    collapse_frozen: bool = False
    frozen_px: float = 0.0
    # --- session level ---
    min_events: int = 150
    min_moves: int = 100
    min_duration_s: float = 20.0
    max_dt_median_s: float = 0.40
    # --- stroke level ---
    max_speed_px_s: float = 6000.0
    max_path_px: float = 20000.0
    drop_zero_var_strokes: bool = True
    # --- feature level ---
    max_nan_frac: float = 0.50
    min_unique: int = 3
    winsor_mad: float = 6.0
    log1p_skew: float = 3.0
    scaler: str = "robust"          # "robust" | "standard" | "none"
    corr_prune: float = 0.0         # 0 disables; else drop |r| above this


def _despike_mask(x, y, jump_px, ratio):
    n = len(x)
    bad = np.zeros(n, dtype=bool)
    if n < 3:
        return bad
    d = np.hypot(np.diff(x), np.diff(y))
    a, b = d[:-1], d[1:]
    c = np.hypot(x[2:] - x[:-2], y[2:] - y[:-2])
    bad[1:-1] = (a > jump_px) & (b > jump_px) & (c < ratio * (a + b))
    return bad


def clean_events(raw: pd.DataFrame, cfg: Config = Config(), pcfg: PrepConfig = PrepConfig()):
    rep = {"n_raw": len(raw)}
    df = raw.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]

    tcol = cfg.time_col.strip().lower()
    for c in (tcol, "x", "y", "state"):
        if c not in df.columns:
            raise KeyError(f"expected column {c!r} in {list(df.columns)}")

    out = pd.DataFrame({
        "t":      pd.to_numeric(df[tcol], errors="coerce").astype("float64"),
        "x":      pd.to_numeric(df["x"], errors="coerce").astype("float64"),
        "y":      pd.to_numeric(df["y"], errors="coerce").astype("float64"),
        "state":  df["state"].astype(str).str.strip().str.lower(),
        "button": (df["button"] if "button" in df.columns else "nobutton").astype(str).str.strip().str.lower(),
    })

    n = len(out); out = out.dropna(subset=["t", "x", "y"]);            rep["drop_nan"] = n - len(out)

    if pcfg.drop_scroll:
        n = len(out)
        out = out[~(out.button.str.contains("scroll") | out.state.str.contains("scroll"))]
        rep["drop_scroll"] = n - len(out)

    n = len(out)
    out = out[out.x.between(*pcfg.x_range) & out.y.between(*pcfg.y_range)];  rep["drop_oob"] = n - len(out)

    if pcfg.drop_out_of_order and len(out):
        t = out.t.values
        keep = t >= np.maximum.accumulate(t) - 1e-9
        rep["drop_backwards"] = int((~keep).sum())
        out = out[keep]
    else:
        rep["drop_backwards"] = 0

    out = out.sort_values("t", kind="mergesort").reset_index(drop=True)
    out["is_move"] = out.state.isin(MOVE_STATES)

    n = len(out)
    moves  = out[out.is_move].drop_duplicates(subset="t", keep="last")
    others = out[~out.is_move]
    out = pd.concat([moves, others]).sort_values("t", kind="mergesort").reset_index(drop=True)
    rep["drop_tied_t"] = n - len(out)

    if pcfg.despike and out.is_move.any():
        mv = out.index[out.is_move.values].to_numpy()
        bad = _despike_mask(out.x.values[mv], out.y.values[mv], pcfg.despike_px, pcfg.despike_ratio)
        rep["drop_spikes"] = int(bad.sum())
        if bad.any():
            out = out.drop(index=mv[bad]).reset_index(drop=True)
    else:
        rep["drop_spikes"] = 0

    if pcfg.collapse_frozen and out.is_move.any():
        mv = out.is_move.values
        same = np.zeros(len(out), dtype=bool)
        same[1:] = mv[1:] & mv[:-1] & (np.abs(np.diff(out.x.values)) <= pcfg.frozen_px) \
                                    & (np.abs(np.diff(out.y.values)) <= pcfg.frozen_px)
        rep["drop_frozen"] = int(same.sum())
        out = out[~same].reset_index(drop=True)
    else:
        rep["drop_frozen"] = 0

    if cfg.screen_w: out["x"] = out["x"] / cfg.screen_w
    if cfg.screen_h: out["y"] = out["y"] / cfg.screen_h

    rep["n_clean"] = len(out)
    return out.reset_index(drop=True), rep


def session_report(ev: pd.DataFrame, pcfg: PrepConfig = PrepConfig()) -> dict:
    mv = ev[ev.is_move]
    dt = np.diff(mv.t.values); dt = dt[dt > 0]
    d = {
        "n_events":  len(ev),
        "n_moves":   len(mv),
        "n_clicks":  int(ev.state.isin(DOWN_STATES).sum()),
        "duration_s": float(ev.t.max() - ev.t.min()) if len(ev) else 0.0,
        "dt_median": float(np.median(dt)) if dt.size else np.nan,
        "hz":        float(1 / np.median(dt)) if dt.size else np.nan,
    }
    reasons = []
    if d["n_events"]   < pcfg.min_events:      reasons.append("few_events")
    if d["n_moves"]    < pcfg.min_moves:       reasons.append("few_moves")
    if d["duration_s"] < pcfg.min_duration_s:  reasons.append("short")
    if not np.isfinite(d["dt_median"]) or d["dt_median"] > pcfg.max_dt_median_s:
        reasons.append("slow_sampling")
    d["keep"] = len(reasons) == 0
    d["drop_reason"] = ",".join(reasons)
    return d


PREP = PrepConfig()

PREP = PrepConfig()

def load_events(path, cfg: Config = Config()) -> pd.DataFrame:      # noqa: F811
    """Overrides the version in the feature cell so file- and memory-paths clean identically."""
    return clean_events(pd.read_csv(path), cfg, PREP)[0]


def process_frame(raw: pd.DataFrame, user: str, session: str,
                  cfg: Config = Config(), pcfg: PrepConfig = PREP, keep_seqs: bool = True):
    """Returns (stroke feature table, QC record, raw point sequences).

    The feature table is no longer model input -- the encoder eats the raw
    sequences. It is kept because every QC threshold downstream (`v_max`,
    `path_len`, `duration`) is defined on it, and because it is the baseline the
    raw model has to beat.
    """
    ev, rep = clean_events(raw, cfg, pcfg)
    qc = {"user": user, "session": session, **rep, **session_report(ev, pcfg)}
    if not qc["keep"]:
        return pd.DataFrame(), qc, {}
    raw_strokes = segment_strokes(ev, cfg)
    st = strokes_to_frame(raw_strokes, cfg)
    qc["n_strokes"] = len(st)
    seqs = {}
    if len(st):
        st.insert(0, "session", session)
        st.insert(0, "user", user)
        if keep_seqs:
            # stroke_id indexes raw_strokes, so surviving strokes map straight back
            for sid in st.stroke_id.to_numpy():
                t, x, y, is_drag, _click = raw_strokes[int(sid)]
                seqs[(user, session, int(sid))] = (
                    np.asarray(t, dtype=np.float64),
                    np.asarray(x, dtype=np.float32),
                    np.asarray(y, dtype=np.float32),
                    bool(is_drag),
                )
    else:
        qc["keep"], qc["drop_reason"] = False, "no_strokes"
    return st, qc, seqs


def process_loaded(users: dict, cfg: Config = Config(), pcfg: PrepConfig = PREP,
                   progress_every: int = 100, keep_seqs: bool = True):
    cfg = replace(cfg, verbose=False)
    frames, qcs, seqs, t0, i = [], [], {}, time.time(), 0
    total = sum(len(s) for s in users.values())
    for u, sessions in users.items():
        for sname, raw in sessions.items():
            i += 1
            try:
                st, qc, sq = process_frame(raw, u, sname, cfg, pcfg, keep_seqs)
            except Exception as e:
                qcs.append({"user": u, "session": sname, "keep": False,
                            "drop_reason": f"error:{type(e).__name__}"})
                warnings.warn(f"{u}/{sname}: {e}")
                continue
            qcs.append(qc)
            if len(st):
                frames.append(st); seqs.update(sq)
            if progress_every and i % progress_every == 0:
                print(f"  {i}/{total} sessions  ({time.time()-t0:.0f}s)")
    qc = pd.DataFrame(qcs)
    strokes = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    n_pts = sum(len(v[0]) for v in seqs.values())
    print(f"[pipeline] {qc.keep.sum()}/{len(qc)} sessions kept, "
          f"{len(strokes):,} strokes, {n_pts:,} raw points, {time.time()-t0:.0f}s")
    if (~qc.keep).any():
        print(qc.loc[~qc.keep, "drop_reason"].value_counts().to_string())
    return strokes, qc, seqs


def filter_strokes(df: pd.DataFrame, pcfg=None, verbose=True) -> pd.DataFrame:
    pcfg = pcfg or PrepConfig()
    n0 = len(df); drops = {}
    m = pd.Series(True, index=df.index)

    bad = df.v_max > pcfg.max_speed_px_s;        drops["impossible_speed"] = int(bad.sum()); m &= ~bad
    bad = df.path_len > pcfg.max_path_px;        drops["huge_path"] = int(bad.sum());        m &= ~bad
    if pcfg.drop_zero_var_strokes:
        bad = (df.v_std == 0) | (df.bbox_area == 0)
        drops["degenerate"] = int(bad.sum()); m &= ~bad
    bad = ~np.isfinite(df.duration) | (df.duration <= 0)
    drops["bad_duration"] = int(bad.sum()); m &= ~bad

    out = df[m].reset_index(drop=True)
    if verbose:
        print(f"[strokes] {len(out):,}/{n0:,} kept  " +
              "  ".join(f"-{k}:{v}" for k, v in drops.items() if v))
    return out


NON_FEATURE_ALL = {"user", "session", "stroke_id", "t_start", "t_end", "n_strokes", "span_s"}
# structurally-missing columns: NaN means "no click happened", not "unknown"
STRUCTURAL_NAN = {"click_dwell", "click_button_left", "click_delay", "click_dist_end",
                  "overshoot_path", "overshoot_max"}


def apply_preprocessor(df: pd.DataFrame, pre: dict) -> pd.DataFrame:
    """Returns FEATURES ONLY, row order preserved -- no user/session/t_start columns.

    Keeping metadata out of the matrix is deliberate: `t_start` is a position in the
    session, and a model handed that column will happily learn it.
    """
    cols = pre["features"]
    X = df.reindex(columns=cols).astype("float64")
    logc = [c for c in pre["log_cols"] if c in cols]
    if logc:
        X[logc] = np.log1p(X[logc].clip(lower=-0.999999))
    X = X.clip(pd.Series(pre["lo"])[cols], pd.Series(pre["hi"])[cols], axis=1)
    X = X.fillna(pd.Series(pre["fill"])[cols])
    X = (X - pd.Series(pre["center"])[cols]) / pd.Series(pre["scale"])[cols]
    return X.replace([np.inf, -np.inf], 0.0).reset_index(drop=True)


@dataclass
class ModelConfig:
    # --- windowing ---
    n_strokes: int = 12            # strokes per window (the unit that gets embedded)
    stride: int = 4
    max_span_s: float = 240.0      # drop windows where the user walked away mid-way
    # 12/4/240, not 25/8/90: at ~9 Hz a 25-stroke window routinely spans minutes, so
    # max_span_s=90 was silently discarding ~75% of all windows.
    # --- stroke front end (raw sequence -> one vector) ---
    d_conv: int = 64               # width of the temporal conv stack
    kernel: int = 5
    dilations: tuple = (1, 2, 4)   # receptive field ~ 1 + 2*(k-1)*sum(dil) = 29 samples
    d_stroke: int = 128            # per-stroke vector handed to the set encoder
    # --- window encoder ---
    d_hidden: int = 256
    d_embed: int = 64
    n_layers: int = 2
    dropout: float = 0.15
    pool: str = "attn+meanstd"     # "mean" | "meanstd" | "attn+meanstd"
    # --- loss ---
    loss: str = "supcon"           # "supcon" | "batch_hard" | "contrastive"
    temperature: float = 0.1       # supcon only
    margin: float = 0.0            # batch_hard only
    # Both triplet forms collapsed this dataset. They penalise the DIFFERENCE
    # dp - dn, which scales with the embedding radius, so shrinking everything
    # toward a single point reduces the loss monotonically: margin=0.25 parked at
    # loss==0.25, margin=0 parked at softplus(0)=ln2=0.693. supcon is a softmax
    # over cosine similarities and has the opposite behaviour -- a collapsed
    # embedding makes every logit equal, which is its WORST case, not its best.
    # --- optimisation ---
    P_users: int = 8               # users per batch
    K_windows: int = 6             # windows per user per batch  (batch = P*K)
    lr: float = 5e-4               # 2e-3 collapsed the embedding during the warm-up ramp
    weight_decay: float = 1e-2
    epochs: int = 60
    steps_per_epoch: int = 60
    patience: int = 12
    eval_max_windows: int = 3000   # per-epoch validation subsample; full sets in evaluate()
    embed_bs: int = 64
    seed: int = 0


# Masked-out logits / maxima. A hard-coded -1e9 raises outright in float16
# (max ~65504), so anything under torch.autocast on a T4 would die here; taking
# the sentinel from the tensor's own dtype keeps fp16 and fp32 paths identical.
def _neg(t):
    return torch.finfo(t.dtype).min


def _pos(t):
    return torch.finfo(t.dtype).max


class AttnPool(nn.Module):
    """Learned-query attention pooling over one axis, mask-aware."""
    def __init__(self, d):
        super().__init__()
        self.score = nn.Sequential(nn.Linear(d, d // 2), nn.Tanh(), nn.Linear(d // 2, 1))

    def forward(self, h, mask=None):            # h: (B, N, d), mask: (B, N) bool
        s = self.score(h).squeeze(-1)
        if mask is not None:
            s = s.masked_fill(~mask, _neg(s))
        w = torch.softmax(s, dim=1)
        return (h * w.unsqueeze(-1)).sum(1), w


class ResConvBlock(nn.Module):
    """Dilated residual conv over the time axis, re-masked at both ends."""
    def __init__(self, d, k, dil, p):
        super().__init__()
        self.conv = nn.Conv1d(d, d, k, padding=dil * (k - 1) // 2, dilation=dil)
        self.norm = nn.LayerNorm(d)
        self.drop = nn.Dropout(p)

    def forward(self, h, mf):                   # h: (B, d, L), mf: (B, 1, L) float
        z = self.conv(h * mf)                   # zero the padding before it is convolved in
        z = self.norm(z.transpose(1, 2)).transpose(1, 2)
        return (h + self.drop(F.gelu(z))) * mf


class StrokeSeqEncoder(nn.Module):
    """One variable-length stroke of raw points -> one fixed-size vector.

    Two things this has to survive, both properties of the capture and not of the
    user:

    * **Irregular sampling.** The gap between samples is not constant, so an
      ordinary CNN over the position sequence would be reading a distorted clock.
      Rather than resampling onto a uniform grid -- which invents points that
      were never observed and erases the timing jitter that is itself
      identifying -- `dt` is handed in as an input channel. The network is free
      to learn velocity, or anything else, as a function of (dx, dy, dt).
    * **Variable length.** Strokes run from `min_points` to `max_len` samples.
      Padding is masked out of every reduction below, so a 7-point stroke and a
      120-point stroke are both summarised without the padding contributing.

    Pooling is mean+std+max+attention over time: order *within* a stroke is real
    signal (unlike order within a window), but the pooled summary still has to be
    length-invariant.
    """
    def __init__(self, n_ch, mcfg: ModelConfig):
        super().__init__()
        d = mcfg.d_conv
        self.inp = nn.Linear(n_ch, d)
        self.blocks = nn.ModuleList(
            [ResConvBlock(d, mcfg.kernel, dil, mcfg.dropout) for dil in mcfg.dilations])
        self.attn = AttnPool(d)
        self.out = nn.Sequential(
            nn.Linear(4 * d, mcfg.d_stroke), nn.LayerNorm(mcfg.d_stroke), nn.GELU())

    def forward(self, x, m):                    # x: (B, L, C), m: (B, L) bool
        mf = m.unsqueeze(1).to(x.dtype)         # (B, 1, L)
        h = (self.inp(x).transpose(1, 2)) * mf  # (B, d, L)
        for blk in self.blocks:
            h = blk(h, mf)
        h = h.transpose(1, 2)                   # (B, L, d)

        mb = m.unsqueeze(-1)
        n = m.sum(1, keepdim=True).clamp_min(1).to(x.dtype)
        mean = (h * mb).sum(1) / n
        var = (((h - mean.unsqueeze(1)) ** 2) * mb).sum(1) / n
        std = var.clamp_min(1e-8).sqrt()
        mx = h.masked_fill(~mb, _neg(h)).max(1).values
        att, _ = self.attn(h, m)
        return self.out(torch.cat([att, mean, std, mx], dim=-1))


class StrokeSetEncoder(nn.Module):
    """Window of N per-stroke vectors -> one L2-normalised embedding.

    Per-stroke MLP, then pooling over the stroke axis. Pooling is permutation
    invariant by design: within a 25-stroke window the ordering is close to
    arbitrary, and an order-sensitive encoder (GRU/transformer) mostly learns
    session-specific sequencing, which is exactly the thing that does not
    transfer to a new session.
    """
    def __init__(self, d_in, mcfg: ModelConfig):
        super().__init__()
        d, p = mcfg.d_hidden, mcfg.dropout
        layers, prev = [], d_in
        for _ in range(mcfg.n_layers):
            layers += [nn.Linear(prev, d), nn.LayerNorm(d), nn.GELU(), nn.Dropout(p)]
            prev = d
        self.stroke = nn.Sequential(*layers)
        self.pool_mode = mcfg.pool
        self.attn = AttnPool(d) if "attn" in mcfg.pool else None
        mult = {"mean": 1, "meanstd": 2, "attn+meanstd": 3}[mcfg.pool]
        self.head = nn.Sequential(
            nn.Linear(d * mult, d), nn.LayerNorm(d), nn.GELU(), nn.Dropout(p),
            nn.Linear(d, mcfg.d_embed),
        )

    def forward(self, x, return_attn=False):     # x: (B, N, d_in)
        h = self.stroke(x)
        parts = [h.mean(1)]
        if "std" in self.pool_mode:
            parts.append(h.std(1, unbiased=False))
        w = None
        if self.attn is not None:
            a, w = self.attn(h)
            parts.insert(0, a)
        z = F.normalize(self.head(torch.cat(parts, dim=-1)), dim=-1)
        return (z, w) if return_attn else z


class RawWindowEncoder(nn.Module):
    """(B, N, L, C) raw points -> (B, d_embed) L2-normalised window embedding.

    Two levels, and the split is deliberate: *inside* a stroke time order matters
    and the conv stack reads it; *across* strokes in a window it does not, and
    the set encoder throws it away.
    """
    def __init__(self, n_ch, mcfg: ModelConfig):
        super().__init__()
        self.n_ch = n_ch
        self.seq = StrokeSeqEncoder(n_ch, mcfg)
        self.set = StrokeSetEncoder(mcfg.d_stroke, mcfg)

    def forward(self, x, m, return_attn=False):
        B, N, L, C = x.shape
        h = self.seq(x.reshape(B * N, L, C), m.reshape(B * N, L)).view(B, N, -1)
        return self.set(h, return_attn=return_attn)


class FeatureWindowEncoder(nn.Module):
    """Baseline encoder: the hand-crafted per-stroke feature vectors straight into
    the same set encoder, same pooling, same loss, same windows.

    It takes (x, m) like RawWindowEncoder and ignores the mask, so both models
    are interchangeable everywhere downstream -- train_siamese, embed, evaluate
    and save_model never branch on which one they were handed.
    """
    def __init__(self, d_in, mcfg: ModelConfig):
        super().__init__()
        self.n_ch = d_in
        self.set = StrokeSetEncoder(d_in, mcfg)

    def forward(self, x, m=None, return_attn=False):
        return self.set(x, return_attn=return_attn)




# ===========================================================================
# Deployment API
# ===========================================================================


class MouseAuth:
    """Enrol a person from one recording, verify them from another.

    A bundle is self-contained: encoder weights, the preprocessor fitted on the
    training fold, the pipeline configs, and a threshold calibrated on users the
    encoder never trained on. Loading one and calling `enrol` / `verify` is the
    whole deployment surface.
    """

    def __init__(self, enc, pre, cfg, pcfg, mcfg, thresholds, meta=None):
        self.enc, self.pre = enc, pre
        self.cfg, self.pcfg, self.mcfg = cfg, pcfg, mcfg
        self.thresholds = thresholds
        self.meta = meta or {}

    # -- persistence --------------------------------------------------------
    @classmethod
    def load(cls, path, device=None):
        path = Path(path)
        dev = device or DEVICE
        ck = torch.load(path / "encoder.pt", map_location=dev, weights_only=False)
        mcfg = ModelConfig(**ck["model_config"])
        enc = FeatureWindowEncoder(ck["n_ch"], mcfg).to(dev)
        enc.load_state_dict(ck["state_dict"]); enc.eval()
        b = json.loads((path / "bundle.json").read_text())
        return cls(enc, joblib.load(path / "preprocessor.joblib"),
                   Config(**b["cfg"]), PrepConfig(**b["pcfg"]), mcfg,
                   b["thresholds"], b.get("meta"))

    def save(self, path):
        path = Path(path); path.mkdir(parents=True, exist_ok=True)
        torch.save({"state_dict": self.enc.state_dict(), "n_ch": self.enc.n_ch,
                    "model_config": asdict(self.mcfg)}, path / "encoder.pt")
        joblib.dump(self.pre, path / "preprocessor.joblib")
        (path / "bundle.json").write_text(json.dumps(
            {"cfg": asdict(self.cfg), "pcfg": asdict(self.pcfg),
             "thresholds": self.thresholds, "meta": self.meta}, indent=2, default=float))
        print(f"[bundle] -> {path}")
        return path

    # -- core ---------------------------------------------------------------
    def _windows(self, source):
        """A raw session (path or DataFrame) -> (n_windows, d_embed) embeddings."""
        raw = load_session(source) if isinstance(source, (str, Path)) else source
        st, qc, _ = process_frame(raw, "probe", "probe",
                                  replace(self.cfg, verbose=False), self.pcfg,
                                  keep_seqs=False)
        if not len(st):
            raise ValueError(f"session rejected by QC: {qc.get('drop_reason')}")
        st = filter_strokes(st, self.pcfg, verbose=False).reset_index(drop=True)
        n = self.mcfg.n_strokes
        if len(st) < n:
            raise ValueError(f"only {len(st)} usable strokes, need {n}")
        V = apply_preprocessor(st, self.pre).to_numpy(dtype=np.float32)
        idx = [np.arange(e - n, e) for e in range(n, len(st) + 1, self.mcfg.stride)]
        # the encoder's OWN device, not the module-level default: a bundle loaded
        # with device="cpu" on a machine that has mps would otherwise send the
        # input to mps and die on a weight/input device mismatch
        dev = next(self.enc.parameters()).device
        X = torch.from_numpy(np.stack([V[i] for i in idx])).to(dev)
        with torch.no_grad():
            return self.enc(X, None).cpu().numpy()

    def enrol(self, sources):
        """One or more recordings of one person -> a unit-norm template."""
        if isinstance(sources, (str, Path)) or isinstance(sources, pd.DataFrame):
            sources = [sources]
        z = np.concatenate([self._windows(s) for s in sources])
        t = z.mean(0)
        return {"template": t / np.linalg.norm(t), "n_windows": int(len(z))}

    def verify(self, source, template, operating_point="frr5"):
        """Is this recording the enrolled person? Returns the score, the decision,
        and the numbers behind it -- never just a boolean."""
        t = template["template"] if isinstance(template, dict) else template
        z = self._windows(source)
        s = z.mean(0); s /= np.linalg.norm(s)
        score = float(s @ t)
        thr = self.thresholds[operating_point]
        return {"score": score, "threshold": float(thr), "accept": bool(score >= thr),
                "operating_point": operating_point, "n_windows": int(len(z)),
                "per_window_scores": (z @ t)}

    def identify(self, source, templates):
        """Rank a recording against a dict of {user: template}."""
        z = self._windows(source)
        s = z.mean(0); s /= np.linalg.norm(s)
        rows = [{"user": u, "score": float(s @ (t["template"] if isinstance(t, dict) else t))}
                for u, t in templates.items()]
        return (pd.DataFrame(rows).sort_values("score", ascending=False)
                .reset_index(drop=True))
