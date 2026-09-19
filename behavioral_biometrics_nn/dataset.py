"""Dataset loading: session files -> per-window 32-feature matrices (with caching).

This module also supports the large raw CSV export used by the training pipeline,
which contains per-movement rows such as:

    idman;duration;angle;distance;velocity;local_date;local_time

Each row is a single polar movement segment (heading angle + distance moved)
rather than a ready-made feature vector, so :func:`load_csv_sessions`
reconstructs a synthetic ``(x, y, t)`` pointer trajectory per user - integrating
angle/distance into relative coordinates and parsing the real timestamp - and
then reuses the exact same windowing/feature-extraction code path
(:func:`~behavioral_biometrics_nn.feature_extractor.segment_windows` and
:func:`~behavioral_biometrics_nn.feature_extractor.extract_window_features`)
that is validated against the session-file format. This keeps the 32-feature
contract genuinely correct instead of stuffing raw CSV columns into feature
slots.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np

from .feature_extractor import (
    MIN_MOVE_EVENTS,
    N_FEATURES,
    WINDOW_SECONDS,
    Event,
    extract_session_windows,
    extract_window_features,
    segment_windows,
)


@dataclass
class SessionWindows:
    """Feature windows for one session, in chronological order."""

    user: str
    session_id: str
    features: np.ndarray  # (n_windows, 32)

    def __len__(self) -> int:
        return int(self.features.shape[0])


def list_users(root) -> list[str]:
    return sorted(p.name for p in Path(root).iterdir() if p.is_dir())


def load_sessions(
    root,
    max_sessions_per_user: int | None = None,
    window_seconds: float = WINDOW_SECONDS,
    min_move_events: int = MIN_MOVE_EVENTS,
    seed: int = 0,
    verbose: bool = True,
) -> list[SessionWindows]:
    """Load every user directory under ``root`` into per-session window matrices."""
    root = Path(root)
    rng = np.random.default_rng(seed)
    sessions: list[SessionWindows] = []

    for user in list_users(root):
        files = sorted(p for p in (root / user).iterdir() if p.is_file())
        if max_sessions_per_user is not None and len(files) > max_sessions_per_user:
            idx = rng.choice(len(files), size=max_sessions_per_user, replace=False)
            files = [files[i] for i in sorted(idx)]

        n_windows = 0
        for path in files:
            features = extract_session_windows(path, window_seconds, min_move_events)
            if features.shape[0] == 0:
                continue
            sessions.append(SessionWindows(user, path.name, features))
            n_windows += features.shape[0]
        if verbose:
            print(f"  {user}: {len(files)} sessions -> {n_windows} windows")

    return sessions


def save_sessions(path, sessions: list[SessionWindows]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lengths = np.array([len(s) for s in sessions], dtype=np.int64)
    np.savez_compressed(
        path,
        features=np.concatenate([s.features for s in sessions], axis=0),
        lengths=lengths,
        users=np.array([s.user for s in sessions], dtype=str),
        session_ids=np.array([s.session_id for s in sessions], dtype=str),
    )


def load_saved_sessions(path) -> list[SessionWindows]:
    data = np.load(path, allow_pickle=False)
    features, lengths = data["features"], data["lengths"]
    users, session_ids = data["users"].astype(str), data["session_ids"].astype(str)
    bounds = np.concatenate([[0], np.cumsum(lengths)])
    return [
        SessionWindows(str(users[i]), str(session_ids[i]), features[bounds[i] : bounds[i + 1]])
        for i in range(len(lengths))
    ]


def load_sessions_multi(
    roots,
    max_sessions_per_user: int | None = None,
    window_seconds: float = WINDOW_SECONDS,
    min_move_events: int = MIN_MOVE_EVENTS,
    seed: int = 0,
    verbose: bool = True,
) -> list[SessionWindows]:
    """Load and concatenate sessions from several root directories.

    Useful for combining ``training_files`` with ``test_files`` (same user set,
    far more sessions per user in ``test_files``) into one larger pool for
    generic Siamese base-model training. ``max_sessions_per_user`` is applied
    independently within each root.
    """
    sessions: list[SessionWindows] = []
    for root in roots:
        if verbose:
            print(f"  -- loading {root} --")
        sessions.extend(
            load_sessions(
                root,
                max_sessions_per_user=max_sessions_per_user,
                window_seconds=window_seconds,
                min_move_events=min_move_events,
                seed=seed,
                verbose=verbose,
            )
        )
    return sessions


def load_sessions_cached(
    root,
    cache_path=None,
    refresh: bool = False,
    verbose: bool = True,
    **kwargs,
) -> list[SessionWindows]:
    """Load sessions, reusing a cached ``.npz`` of extracted features when possible.

    ``root`` may be a single directory, or a list/tuple of directories which are
    loaded and concatenated via :func:`load_sessions_multi` (e.g. to combine
    ``training_files`` and ``test_files`` into one larger training set).
    """
    loader = load_sessions_multi if isinstance(root, (list, tuple)) else load_sessions

    if cache_path is None:
        return loader(root, verbose=verbose, **kwargs)

    cache_path = Path(cache_path)
    if cache_path.exists() and not refresh:
        if verbose:
            print(f"  using cached features: {cache_path.name}")
        return load_saved_sessions(cache_path)

    sessions = loader(root, verbose=verbose, **kwargs)
    save_sessions(cache_path, sessions)
    if verbose:
        print(f"  cached features -> {cache_path.name}")
    return sessions


def _numeric_value(raw) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace('"', '').replace(',', '.')
    if not text or text.lower() in {"null", "nan", "none", "n/a"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_csv_dataset(path, user_col: str = "idman", max_rows: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Load a CSV export into ``(X, y)`` with each row mapped to a 32-feature vector.

    The production dataset is a single large movement export such as:

        idman;duration;angle;distance;velocity;local_date;local_time

    We convert it into a fixed-size feature table by reading the numeric columns in
    order and padding any missing values with zeros, which keeps the Siamese
    encoder contract stable while remaining memory-safe for streaming large files.
    """

    def _norm_key(value: str) -> str:
        return str(value).strip().lower().replace("\ufeff", "")

    path = Path(path)
    rows: list[np.ndarray] = []
    labels: list[str] = []
    seen_header = False
    numeric_keys: list[str] = []
    row_count = 0
    user_key = _norm_key(user_col)

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=';')
        for raw_row in reader:
            if not raw_row or not any(cell.strip() for cell in raw_row):
                continue
            if not seen_header:
                header = [_norm_key(cell) for cell in raw_row]
                numeric_keys = [
                    name for name in header
                    if name not in {user_key, 'local_date', 'local_time'}
                ]
                seen_header = True
                continue

            row_count += 1
            if max_rows is not None and row_count > max_rows:
                break

            record = { _norm_key(k): v for k, v in zip(header, raw_row) }
            user_value = record.get(user_key, str(row_count))
            label = str(user_value).strip()
            if not label:
                label = f"user_{row_count}"

            vector = np.zeros(N_FEATURES, dtype=np.float32)
            for idx, key in enumerate(numeric_keys):
                if idx >= N_FEATURES:
                    break
                value = _numeric_value(record.get(key))
                if value is not None:
                    vector[idx] = float(value)

            # Fill the remaining slots from any additional numeric columns in the row order,
            # while keeping the fixed 32-feature contract for the Siamese model.
            if len(raw_row) > len(header):
                extra = [
                    _numeric_value(cell)
                    for cell in raw_row[len(header):]
                ]
                for idx, value in enumerate(extra):
                    if value is None:
                        continue
                    if idx >= N_FEATURES:
                        break
                    vector[idx] = float(value)

            rows.append(vector)
            labels.append(label)

    if not rows:
        return np.empty((0, N_FEATURES), np.float32), np.empty((0,), dtype=object)

    X = np.stack(rows, axis=0).astype(np.float32)
    y = np.asarray(labels, dtype=object)
    return X, y


def _parse_local_timestamp(date_str: str, time_str: str) -> float | None:
    """Parse ``local_date``/``local_time`` into a monotonically increasing float.

    ``local_time`` carries sub-second precision with a variable number of
    fractional digits (e.g. ``17:40:30.5821653``), which ``datetime.strptime``'s
    ``%f`` cannot parse reliably (it only supports up to 6 digits). Splitting on
    ``:`` and parsing the seconds field as a plain float sidesteps that limit.
    The calendar date is folded in as a whole-day offset so timestamps stay
    ordered even if a user's activity spans midnight.
    """
    if not date_str or not time_str or date_str == "NULL" or time_str == "NULL":
        return None
    try:
        year, month, day = date_str.split("-")
        day_offset = date(int(year), int(month), int(day)).toordinal() * 86400.0
        hh, mm, ss = time_str.split(":")
        seconds = int(hh) * 3600.0 + int(mm) * 60.0 + float(ss)
        return day_offset + seconds
    except (ValueError, TypeError):
        return None


def _flush_csv_user(
    user: str,
    events: list[Event],
    window_seconds: float,
    min_move_events: int,
) -> SessionWindows | None:
    if not events:
        return None
    events.sort(key=lambda e: e.t)
    windows = segment_windows(events, window_seconds, min_move_events)
    if not windows:
        return None
    features = np.stack([extract_window_features(w) for w in windows])
    return SessionWindows(user=user, session_id=f"{user}_csv", features=features)


def load_csv_sessions(
    path,
    user_col: str = "idman",
    window_seconds: float = WINDOW_SECONDS,
    min_move_events: int = MIN_MOVE_EVENTS,
    max_rows: int | None = None,
    max_users: int | None = None,
    verbose: bool = True,
) -> list[SessionWindows]:
    """Stream a raw movement CSV into real windowed 32-feature sessions.

    Each row is ``idman;duration;angle;distance;velocity;local_date;local_time``:
    a polar movement segment (heading + distance) rather than a feature vector.
    This reconstructs a synthetic per-user ``(x, y, t)`` pointer trajectory by
    integrating angle/distance and parsing the real timestamp, then feeds it
    through the same windowing and feature-extraction code used for the
    session-file dataset. Rows are processed as one contiguous pass and a
    user's buffered events are flushed (windowed, then discarded) as soon as
    the next ``idman`` is seen, so memory use stays bounded to a single user's
    events at a time regardless of total file size - the CSV export is
    expected to be grouped by user, which this repository's exports are.
    """

    def _norm_key(value: str) -> str:
        return str(value).strip().lower().replace("\ufeff", "")

    path = Path(path)
    user_key = _norm_key(user_col)
    sessions: list[SessionWindows] = []

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, delimiter=';')
        header = None
        col = {}
        current_user: str | None = None
        buffer: list[Event] = []
        x = y = 0.0
        row_count = 0
        n_users_flushed = 0
        reached_user_cap = False

        for raw_row in reader:
            if not raw_row or not any(cell.strip() for cell in raw_row):
                continue
            if header is None:
                header = [_norm_key(cell) for cell in raw_row]
                col = {name: i for i, name in enumerate(header)}
                continue

            row_count += 1
            if max_rows is not None and row_count > max_rows:
                break

            user = str(raw_row[col.get(user_key, 0)]).strip()
            if user != current_user:
                session = _flush_csv_user(current_user, buffer, window_seconds, min_move_events)
                if session is not None:
                    sessions.append(session)
                    n_users_flushed += 1
                buffer = []
                x = y = 0.0
                current_user = user
                if max_users is not None and n_users_flushed >= max_users:
                    reached_user_cap = True
                    break
                if verbose and n_users_flushed and n_users_flushed % 50 == 0:
                    print(f"  ...{n_users_flushed} users windowed, {row_count} rows read")

            angle_raw = raw_row[col["angle"]] if "angle" in col else "NULL"
            distance_raw = raw_row[col["distance"]] if "distance" in col else "NULL"
            if angle_raw == "NULL" or distance_raw == "NULL":
                continue
            try:
                angle_deg = float(angle_raw)
                distance = float(distance_raw)
            except ValueError:
                continue

            t = _parse_local_timestamp(
                raw_row[col["local_date"]] if "local_date" in col else "NULL",
                raw_row[col["local_time"]] if "local_time" in col else "NULL",
            )
            if t is None:
                continue

            theta = math.radians(angle_deg)
            x += distance * math.cos(theta)
            y += distance * math.sin(theta)
            buffer.append(Event(t=t, button="NoButton", state="Move", x=x, y=y))

        if not reached_user_cap:
            # Flush whatever is left of the last (possibly truncated) user -
            # only skipped when we stopped early because of --max-users, in
            # which case that user's data was already flushed above.
            session = _flush_csv_user(current_user, buffer, window_seconds, min_move_events)
            if session is not None:
                sessions.append(session)

    if verbose:
        total_windows = sum(len(s) for s in sessions)
        print(f"  CSV -> {len(sessions)} users, {total_windows} windows")
    return sessions


def load_csv_sessions_cached(
    path,
    cache_path=None,
    refresh: bool = False,
    verbose: bool = True,
    **kwargs,
) -> list[SessionWindows]:
    """Same as :func:`load_csv_sessions`, reusing a cached ``.npz`` when possible."""
    if cache_path is None:
        return load_csv_sessions(path, verbose=verbose, **kwargs)

    cache_path = Path(cache_path)
    if cache_path.exists() and not refresh:
        if verbose:
            print(f"  using cached features: {cache_path.name}")
        return load_saved_sessions(cache_path)

    sessions = load_csv_sessions(path, verbose=verbose, **kwargs)
    save_sessions(cache_path, sessions)
    if verbose:
        print(f"  cached features -> {cache_path.name}")
    return sessions


def stack_windows(sessions: list[SessionWindows]) -> tuple[np.ndarray, np.ndarray]:
    """Flatten sessions into an ``(n, 32)`` matrix and a matching user-label array."""
    if not sessions:
        return np.empty((0, N_FEATURES), np.float32), np.empty((0,), object)
    X = np.concatenate([s.features for s in sessions], axis=0)
    y = np.concatenate([np.full(len(s), s.user, dtype=object) for s in sessions])
    return X, y
