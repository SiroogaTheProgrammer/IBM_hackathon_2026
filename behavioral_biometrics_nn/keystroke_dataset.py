"""Keystroke-dynamics dataset loading (Extension B pretraining, design_choices.txt FILE 4).

Parses the "How We Type" style keystroke corpus under ``Keystrokes/files/``
(one ``<PARTICIPANT_ID>_keystrokes.txt`` per participant, tab-separated
columns ``PARTICIPANT_ID TEST_SECTION_ID SENTENCE USER_INPUT KEYSTROKE_ID
PRESS_TIME RELEASE_TIME LETTER KEYCODE``, times in millisecond epochs) into
fixed-length windows of 6 keystroke-dynamics features.

Windows are built with the *same fixed-time-window segmentation strategy* as
the mouse pipeline (:func:`~behavioral_biometrics_nn.feature_extractor.segment_windows`):
each ``TEST_SECTION_ID`` (one typed sentence) is treated as its own event
stream so a pause between sentences is never mistaken for a pause inside one,
and only the keys that land inside a window contribute to its features (no
cross-window flight time). This keeps the offline training distribution
consistent with what live per-tick scoring will see - the same discipline the
CSV mouse loader follows to avoid a naive column-to-feature stuffing.

The 6-feature layout intentionally reuses the naming/semantics of the
"keyboard dynamics" slots (#21-26) already reserved in
:mod:`behavioral_biometrics_nn.feature_extractor`'s ``FEATURE_NAMES``, but this
is a *separate*, independently pretrained encoder (its own artifacts
directory) - per the late-fusion design, extension features are never stuffed
into the base 32-D mouse vector.
"""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np

from .dataset import SessionWindows, load_saved_sessions, save_sessions

WINDOW_SECONDS = 1.0
MIN_KEYS_PER_WINDOW = 4

# The corpus spells special keys out (see header sample), distinct from the
# browser KeyboardEvent.key names ("Backspace"/"Delete") used by the live
# telemetry client - two different sources, deliberately not unified.
CORRECTION_KEYS = frozenset({"BKSP", "DELETE"})

KEYSTROKE_FEATURE_NAMES = (
    "key_dwell_mean", "key_dwell_std", "flight_time_mean", "flight_time_std",
    "typing_speed", "error_rate_ratio",
)
N_KEYSTROKE_FEATURES = len(KEYSTROKE_FEATURE_NAMES)


def _parse_participant_file(path: Path) -> list[dict]:
    """Read one participant's file into key-event rows, grouped/sorted for windowing.

    Defensive against malformed rows: the raw corpus occasionally has free-text
    ``SENTENCE``/``USER_INPUT`` fields containing stray tabs/newlines that
    desynchronise the column count for that row, so any row that fails to
    parse into the expected fields is skipped rather than aborting the file.
    """
    rows: list[dict] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for raw in reader:
            try:
                press = float(raw["PRESS_TIME"])
                release = float(raw["RELEASE_TIME"])
                section = str(raw["TEST_SECTION_ID"])
                letter = str(raw.get("LETTER", ""))
            except (KeyError, TypeError, ValueError):
                continue
            if release < press:
                continue
            rows.append({"section": section, "press": press, "release": release, "letter": letter})
    rows.sort(key=lambda r: (r["section"], r["press"]))
    return rows


def _window_features(keys: list[dict]) -> list[float]:
    dwell = [k["release"] - k["press"] for k in keys]
    flight: list[float] = []
    corrections = 0
    for i, k in enumerate(keys):
        if i > 0:
            flight.append(k["press"] - keys[i - 1]["release"])
        if k["letter"] in CORRECTION_KEYS:
            corrections += 1

    duration_s = (keys[-1]["press"] - keys[0]["press"]) / 1000.0
    typing_speed = len(keys) / duration_s if duration_s > 0 else 0.0
    error_ratio = corrections / len(keys)

    return [
        float(np.mean(dwell)) if dwell else 0.0,
        float(np.std(dwell)) if len(dwell) > 1 else 0.0,
        float(np.mean(flight)) if flight else 0.0,
        float(np.std(flight)) if len(flight) > 1 else 0.0,
        float(typing_speed),
        float(error_ratio),
    ]


def _windows_from_rows(
    rows: list[dict], window_seconds: float, min_keys: int
) -> list[list[float]]:
    """Bucket key events into fixed-time windows, restarting at each section."""
    features: list[list[float]] = []
    section_rows: list[dict] = []
    current_section = None

    def _flush() -> None:
        if not section_rows:
            return
        t0 = section_rows[0]["press"]
        buckets: dict[int, list[dict]] = {}
        for r in section_rows:
            idx = int((r["press"] - t0) // (window_seconds * 1000.0))
            buckets.setdefault(idx, []).append(r)
        for idx in sorted(buckets):
            keys = buckets[idx]
            if len(keys) >= min_keys:
                features.append(_window_features(keys))

    for row in rows:
        if row["section"] != current_section:
            _flush()
            current_section = row["section"]
            section_rows = []
        section_rows.append(row)
    _flush()
    return features


def load_keystroke_sessions(
    root,
    max_users: int | None = None,
    max_sections_per_user: int | None = None,
    window_seconds: float = WINDOW_SECONDS,
    min_keys: int = MIN_KEYS_PER_WINDOW,
    verbose: bool = True,
) -> list[SessionWindows]:
    """Load ``Keystrokes/files/*_keystrokes.txt`` into per-participant window matrices.

    ``max_users`` caps how many participant files are read (the corpus has
    ~168k files); ``max_sections_per_user`` caps how many typed sentences are
    kept per participant. Both are ``None``/unset by default meaning "no cap".
    """
    root = Path(root)
    files = sorted(root.glob("*_keystrokes.txt"))
    if max_users is not None and max_users > 0:
        files = files[:max_users]

    sessions: list[SessionWindows] = []
    for i, path in enumerate(files):
        participant = path.name.split("_keystrokes")[0]
        rows = _parse_participant_file(path)

        if max_sections_per_user is not None and max_sections_per_user > 0:
            keep: set = set()
            for r in rows:
                if len(keep) >= max_sections_per_user and r["section"] not in keep:
                    continue
                keep.add(r["section"])
            rows = [r for r in rows if r["section"] in keep]

        windows = _windows_from_rows(rows, window_seconds, min_keys)
        if not windows:
            continue
        sessions.append(
            SessionWindows(participant, path.stem, np.asarray(windows, dtype=np.float32))
        )
        if verbose and (i + 1) % 100 == 0:
            print(f"  ...{i + 1}/{len(files)} participant files parsed, {len(sessions)} usable so far")

    if verbose:
        n_windows = sum(len(s) for s in sessions)
        print(f"  {len(sessions)}/{len(files)} participants usable -> {n_windows} windows")
    return sessions


def load_keystroke_sessions_cached(
    root,
    cache_path=None,
    refresh: bool = False,
    verbose: bool = True,
    **kwargs,
) -> list[SessionWindows]:
    """Load keystroke sessions, reusing a cached ``.npz`` of extracted features when possible."""
    if cache_path is None:
        return load_keystroke_sessions(root, verbose=verbose, **kwargs)

    cache_path = Path(cache_path)
    if cache_path.exists() and not refresh:
        if verbose:
            print(f"  using cached features: {cache_path.name}")
        return load_saved_sessions(cache_path)

    sessions = load_keystroke_sessions(root, verbose=verbose, **kwargs)
    save_sessions(cache_path, sessions)
    if verbose:
        print(f"  cached features -> {cache_path.name}")
    return sessions
