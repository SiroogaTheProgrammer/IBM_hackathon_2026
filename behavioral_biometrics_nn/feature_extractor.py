"""Telemetry feature extraction.

Implements the 32-feature vector defined in ``design_choices.txt`` (FILE 2).
Features are computed per sampling window (1 s) over raw pointer events.

Input data format (Balabit-style session CSV)::

    record timestamp,client timestamp,button,state,x,y
    0.0,0.0,NoButton,Move,1043,410

Note on keyboard features (#21-26): the session files in this repository are
mouse-only (observed ``button`` values are NoButton/Left/Right/Scroll), so those
six slots evaluate to 0.0 here. The slots are kept so the vector layout stays
identical to the one produced by the JS telemetry client, which does emit
``keydown``/``keyup``.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

WINDOW_SECONDS = 1.0
MIN_MOVE_EVENTS = 4
PAUSE_THRESHOLD_S = 0.2
DOUBLE_CLICK_MAX_S = 1.0
RESAMPLE_HZ = 50.0
TREMOR_BAND_HZ = (8.0, 12.0)

MOVEMENT_STATES = frozenset({"Move", "Drag"})
POINTER_BUTTONS = frozenset({"NoButton", "Left", "Right", "Middle", "Scroll"})
CORRECTION_KEYS = frozenset({"Backspace", "Delete"})

FEATURE_NAMES = (
    # 1. Mouse kinematics
    "v_mean", "v_max", "v_std",
    "a_mean", "a_max", "a_std",
    "j_mean", "j_max",
    # 2. Geometry & trajectory
    "path_efficiency", "total_curvature", "mean_angular_velocity",
    "dir_changes_x", "dir_changes_y", "inflection_points",
    # 3. Mouse rhythm & timing
    "click_dwell_mean", "click_dwell_std", "pause_count", "pause_ratio",
    "double_click_latency", "hover_duration_mean",
    # 4. Keyboard dynamics
    "key_dwell_mean", "key_dwell_std", "flight_time_mean", "flight_time_std",
    "typing_speed", "error_rate_ratio",
    # 5. Spectral & tremor dynamics
    "fft_peak_freq_x", "fft_peak_freq_y", "tremor_band_energy", "spectral_entropy",
    # 6. Context & interaction
    "scroll_speed_mean", "scroll_direction_changes",
)

N_FEATURES = len(FEATURE_NAMES)


@dataclass(frozen=True)
class Event:
    t: float
    button: str
    state: str
    x: float
    y: float


def read_session_events(session_path) -> list[Event]:
    """Parse a session CSV into chronologically ordered events."""
    path = Path(session_path)
    events: list[Event] = []
    with path.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "record timestamp" not in reader.fieldnames:
            raise ValueError(f"Unexpected header in {path}: {reader.fieldnames}")
        for row in reader:
            try:
                events.append(
                    Event(
                        t=float(row["record timestamp"]),
                        button=row["button"],
                        state=row["state"],
                        x=float(row["x"]),
                        y=float(row["y"]),
                    )
                )
            except (TypeError, ValueError, KeyError):
                continue  # skip malformed rows
    events.sort(key=lambda e: e.t)
    return events


def segment_windows(
    events: list[Event],
    window_seconds: float = WINDOW_SECONDS,
    min_move_events: int = MIN_MOVE_EVENTS,
) -> list[list[Event]]:
    """Split an event stream into fixed-length windows.

    Windows containing fewer than ``min_move_events`` movement samples are
    dropped: they are the "invalid" vectors referenced by the enrolment step.
    """
    if not events:
        return []

    t0 = events[0].t
    buckets: dict[int, list[Event]] = {}
    for event in events:
        idx = int((event.t - t0) // window_seconds)
        buckets.setdefault(idx, []).append(event)

    windows = []
    for idx in sorted(buckets):
        window = buckets[idx]
        n_moves = sum(1 for e in window if e.state in MOVEMENT_STATES)
        if n_moves >= min_move_events:
            windows.append(window)
    return windows


def _movement_arrays(window: list[Event]):
    t, x, y = [], [], []
    for event in window:
        if event.state in MOVEMENT_STATES:
            t.append(event.t)
            x.append(event.x)
            y.append(event.y)
    return np.asarray(t, float), np.asarray(x, float), np.asarray(y, float)


def _kinematics(t, x, y) -> list[float]:
    """Features 1-8: velocity, acceleration and jerk statistics."""
    if t.size < 2:
        return [0.0] * 8

    dt = np.diff(t)
    step = np.hypot(np.diff(x), np.diff(y))
    valid = dt > 0
    if not np.any(valid):
        return [0.0] * 8

    v = step[valid] / dt[valid]
    t_v = t[1:][valid]
    v_stats = [float(v.mean()), float(v.max()), float(v.std())]

    a_stats = [0.0, 0.0, 0.0]
    j_stats = [0.0, 0.0]
    if v.size >= 2:
        dt_v = np.diff(t_v)
        ok = dt_v > 0
        if np.any(ok):
            a = np.diff(v)[ok] / dt_v[ok]
            t_a = t_v[1:][ok]
            a_stats = [float(a.mean()), float(a.max()), float(a.std())]
            if a.size >= 2:
                dt_a = np.diff(t_a)
                ok_a = dt_a > 0
                if np.any(ok_a):
                    j = np.diff(a)[ok_a] / dt_a[ok_a]
                    j_stats = [float(j.mean()), float(j.max())]

    return v_stats + a_stats + j_stats


def _geometry(t, x, y) -> list[float]:
    """Features 9-14: path shape and direction reversals."""
    if t.size < 2:
        return [0.0] * 6

    dx = np.diff(x)
    dy = np.diff(y)
    step = np.hypot(dx, dy)
    total_distance = float(step.sum())
    direct_distance = float(math.hypot(x[-1] - x[0], y[-1] - y[0]))
    path_efficiency = direct_distance / total_distance if total_distance > 0 else 0.0

    moved = step > 0
    total_curvature = 0.0
    mean_angular_velocity = 0.0
    if np.count_nonzero(moved) >= 2:
        theta = np.arctan2(dy[moved], dx[moved])
        d_theta = np.diff(theta)
        # wrap into [-pi, pi] so a 359 deg turn counts as -1 deg
        d_theta = (d_theta + np.pi) % (2 * np.pi) - np.pi
        total_curvature = float(np.abs(d_theta).sum())
        dt_theta = np.diff(t[1:][moved])
        ok = dt_theta > 0
        if np.any(ok):
            mean_angular_velocity = float(np.mean(np.abs(d_theta[ok]) / dt_theta[ok]))

    def _sign_changes(delta) -> int:
        signs = np.sign(delta)
        signs = signs[signs != 0]
        if signs.size < 2:
            return 0
        return int(np.count_nonzero(np.diff(signs) != 0))

    dir_changes_x = _sign_changes(dx)
    dir_changes_y = _sign_changes(dy)

    inflection_points = 0
    if dx.size >= 2:
        cross = dx[:-1] * dy[1:] - dy[:-1] * dx[1:]
        signs = np.sign(cross)
        signs = signs[signs != 0]
        if signs.size >= 2:
            inflection_points = int(np.count_nonzero(np.diff(signs) != 0))

    return [
        path_efficiency,
        total_curvature,
        mean_angular_velocity,
        float(dir_changes_x),
        float(dir_changes_y),
        float(inflection_points),
    ]


def _rhythm(window: list[Event], t_move) -> list[float]:
    """Features 15-20: click dwell, pauses, double-click latency, hover."""
    dwell_times: list[float] = []
    press_open: dict[str, float] = {}
    press_times: dict[str, list[float]] = {}

    for event in window:
        if event.button in ("NoButton", "Scroll"):
            continue
        if event.state == "Pressed":
            press_open[event.button] = event.t
            press_times.setdefault(event.button, []).append(event.t)
        elif event.state == "Released":
            start = press_open.pop(event.button, None)
            if start is not None and event.t >= start:
                dwell_times.append(event.t - start)

    click_dwell_mean = float(np.mean(dwell_times)) if dwell_times else 0.0
    click_dwell_std = float(np.std(dwell_times)) if len(dwell_times) > 1 else 0.0

    pause_count = 0
    pause_total = 0.0
    if t_move.size >= 2:
        gaps = np.diff(t_move)
        idle = gaps[gaps > PAUSE_THRESHOLD_S]
        pause_count = int(idle.size)
        pause_total = float(idle.sum())

    window_duration = window[-1].t - window[0].t if len(window) >= 2 else 0.0
    pause_ratio = (
        float(np.clip(pause_total / window_duration, 0.0, 1.0)) if window_duration > 0 else 0.0
    )

    latencies: list[float] = []
    for times in press_times.values():
        if len(times) < 2:
            continue
        deltas = np.diff(np.asarray(times, float))
        latencies.extend(float(d) for d in deltas if 0 < d <= DOUBLE_CLICK_MAX_S)
    double_click_latency = float(np.mean(latencies)) if latencies else 0.0

    hovers: list[float] = []
    if t_move.size:
        for event in window:
            if event.state != "Pressed" or event.button in ("NoButton", "Scroll"):
                continue
            before = t_move[t_move <= event.t]
            if before.size:
                hovers.append(float(event.t - before[-1]))
    hover_duration_mean = float(np.mean(hovers)) if hovers else 0.0

    return [
        click_dwell_mean,
        click_dwell_std,
        float(pause_count),
        pause_ratio,
        double_click_latency,
        hover_duration_mean,
    ]


def _keyboard(window: list[Event]) -> list[float]:
    """Features 21-26: keystroke dynamics (all zero for mouse-only sessions)."""
    key_events = [e for e in window if e.button not in POINTER_BUTTONS]
    if not key_events:
        return [0.0] * 6

    dwell: list[float] = []
    flight: list[float] = []
    open_keys: dict[str, float] = {}
    last_release: float | None = None
    press_count = 0
    correction_count = 0

    for event in key_events:
        if event.state == "Pressed":
            press_count += 1
            open_keys[event.button] = event.t
            if event.button in CORRECTION_KEYS:
                correction_count += 1
            if last_release is not None:
                flight.append(event.t - last_release)
        elif event.state == "Released":
            start = open_keys.pop(event.button, None)
            if start is not None and event.t >= start:
                dwell.append(event.t - start)
            last_release = event.t

    duration = key_events[-1].t - key_events[0].t
    typing_speed = press_count / duration if duration > 0 else 0.0
    error_rate = correction_count / press_count if press_count else 0.0

    return [
        float(np.mean(dwell)) if dwell else 0.0,
        float(np.std(dwell)) if len(dwell) > 1 else 0.0,
        float(np.mean(flight)) if flight else 0.0,
        float(np.std(flight)) if len(flight) > 1 else 0.0,
        float(typing_speed),
        float(error_rate),
    ]


def _spectral(t, x, y) -> list[float]:
    """Features 27-30: FFT of the resampled trajectory (tremor band, entropy)."""
    if t.size < 8:
        return [0.0] * 4

    # np.interp needs strictly increasing sample points
    unique_t, keep = np.unique(t, return_index=True)
    if unique_t.size < 8:
        return [0.0] * 4
    duration = float(unique_t[-1] - unique_t[0])
    if duration <= 0:
        return [0.0] * 4

    n = int(duration * RESAMPLE_HZ) + 1
    if n < 8:
        return [0.0] * 4

    grid = np.linspace(unique_t[0], unique_t[-1], n)
    xi = np.interp(grid, unique_t, x[keep])
    yi = np.interp(grid, unique_t, y[keep])

    taper = np.hanning(n)
    xi = (xi - xi.mean()) * taper
    yi = (yi - yi.mean()) * taper

    freqs = np.fft.rfftfreq(n, d=1.0 / RESAMPLE_HZ)
    if freqs.size < 2:
        return [0.0] * 4
    mag_x = np.abs(np.fft.rfft(xi))
    mag_y = np.abs(np.fft.rfft(yi))

    peak_x = float(freqs[int(np.argmax(mag_x[1:])) + 1])
    peak_y = float(freqs[int(np.argmax(mag_y[1:])) + 1])

    power = mag_x**2 + mag_y**2
    total_power = float(power.sum())
    band = (freqs >= TREMOR_BAND_HZ[0]) & (freqs <= TREMOR_BAND_HZ[1])
    tremor_energy = float(power[band].sum() / total_power) if total_power > 0 else 0.0

    spectral_entropy = 0.0
    if total_power > 0:
        p = power / total_power
        p = p[p > 0]
        spectral_entropy = float(-np.sum(p * np.log2(p)))

    return [peak_x, peak_y, tremor_energy, spectral_entropy]


def _scroll(window: list[Event]) -> list[float]:
    """Features 31-32: wheel speed and reversals.

    The dataset records wheel notches (``Scroll`` + ``Up``/``Down``) rather than
    pixel deltas, so ``scroll_speed_mean`` is expressed in notches per second.
    """
    times: list[float] = []
    deltas: list[float] = []
    for event in window:
        if event.button != "Scroll":
            continue
        if event.state == "Up":
            deltas.append(1.0)
        elif event.state == "Down":
            deltas.append(-1.0)
        else:
            continue
        times.append(event.t)

    if len(times) < 2:
        return [0.0, 0.0]

    dt = np.diff(np.asarray(times, float))
    ok = dt > 0
    speed = (
        float(np.mean(np.abs(np.asarray(deltas[1:], float))[ok] / dt[ok]))
        if np.any(ok)
        else 0.0
    )

    signs = np.sign(np.asarray(deltas, float))
    signs = signs[signs != 0]
    reversals = int(np.count_nonzero(np.diff(signs) != 0)) if signs.size >= 2 else 0

    return [speed, float(reversals)]


def extract_window_features(window: list[Event]) -> np.ndarray:
    """Compute the 32-feature vector for a single sampling window."""
    t, x, y = _movement_arrays(window)

    features: list[float] = []
    features += _kinematics(t, x, y)
    features += _geometry(t, x, y)
    features += _rhythm(window, t)
    features += _keyboard(window)
    features += _spectral(t, x, y)
    features += _scroll(window)

    if len(features) != N_FEATURES:
        raise AssertionError(f"expected {N_FEATURES} features, built {len(features)}")

    vector = np.asarray(features, dtype=np.float64)
    return np.nan_to_num(vector, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def extract_session_windows(
    session_path,
    window_seconds: float = WINDOW_SECONDS,
    min_move_events: int = MIN_MOVE_EVENTS,
) -> np.ndarray:
    """Return an ``(n_windows, 32)`` matrix for one session file."""
    events = read_session_events(session_path)
    windows = segment_windows(events, window_seconds, min_move_events)
    if not windows:
        return np.empty((0, N_FEATURES), dtype=np.float32)
    return np.stack([extract_window_features(w) for w in windows])
