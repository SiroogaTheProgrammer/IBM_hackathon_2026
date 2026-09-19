"""Dataset loading: session files -> per-window 32-feature matrices (with caching)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .feature_extractor import (
    MIN_MOVE_EVENTS,
    N_FEATURES,
    WINDOW_SECONDS,
    extract_session_windows,
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


def load_sessions_cached(
    root,
    cache_path=None,
    refresh: bool = False,
    verbose: bool = True,
    **kwargs,
) -> list[SessionWindows]:
    """Load sessions, reusing a cached ``.npz`` of extracted features when possible."""
    if cache_path is None:
        return load_sessions(root, verbose=verbose, **kwargs)

    cache_path = Path(cache_path)
    if cache_path.exists() and not refresh:
        if verbose:
            print(f"  using cached features: {cache_path.name}")
        return load_saved_sessions(cache_path)

    sessions = load_sessions(root, verbose=verbose, **kwargs)
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
