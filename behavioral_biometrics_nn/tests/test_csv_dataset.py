"""Tests for the raw-CSV -> windowed-session pipeline (main_trainset/*.csv)."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.dataset import (
    _parse_local_timestamp,
    load_csv_sessions,
    load_csv_sessions_cached,
    stack_windows,
)
from behavioral_biometrics_nn.feature_extractor import N_FEATURES


def _row(uid, duration, angle, distance, velocity, d, t):
    return f"{uid};{duration};{angle};{distance};{velocity};{d};{t}"


def _make_csv(path: Path) -> None:
    lines = ["\ufeffidman;duration;angle;distance;velocity;local_date;local_time"]
    # user "u1": enough 30deg/50px moves at ~0.1s apart to fill several 2s windows
    t = 0.0
    for i in range(40):
        lines.append(_row("u1", "NULL", 30, 50, 500, "2024-01-01", f"12:00:{t:09.6f}"))
        t += 0.1
    # a NULL-movement row (e.g. a click) should be skipped, not crash the parser
    lines.append(_row("u1", 120, "NULL", "NULL", "NULL", "2024-01-01", "12:00:04.500000"))
    # user "u2": fewer events than MIN_MOVE_EVENTS -> should produce no windows
    lines.append(_row("u2", "NULL", -45, 20, 300, "2024-01-01", "09:00:00.000000"))
    lines.append(_row("u2", "NULL", -45, 20, 300, "2024-01-01", "09:00:00.200000"))
    # user "u3": crosses midnight, must stay monotonically ordered
    t2 = 0.0
    for i in range(40):
        hh = 23 if t2 < 1.0 else 0
        local_t = f"{hh:02d}:59:{t2:09.6f}" if hh == 23 else f"00:00:{(t2 - 1.0):09.6f}"
        day = "2024-01-01" if hh == 23 else "2024-01-02"
        lines.append(_row("u3", "NULL", 10, 30, 300, day, local_t))
        t2 += 0.1
    path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")


class CsvTimestampTests(unittest.TestCase):
    def test_parses_variable_precision_fractional_seconds(self):
        t = _parse_local_timestamp("2018-03-29", "17:40:30.5821653")
        self.assertIsNotNone(t)

    def test_returns_none_for_null_fields(self):
        self.assertIsNone(_parse_local_timestamp("NULL", "12:00:00.0"))
        self.assertIsNone(_parse_local_timestamp("2024-01-01", "NULL"))

    def test_day_boundary_keeps_ordering(self):
        before = _parse_local_timestamp("2024-01-01", "23:59:59.900000")
        after = _parse_local_timestamp("2024-01-02", "00:00:00.100000")
        self.assertLess(before, after)


class CsvSessionLoadingTests(unittest.TestCase):
    def test_builds_real_windows_with_correct_feature_width(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dataset_cleaned4.csv"
            _make_csv(path)
            sessions = load_csv_sessions(path, verbose=False)

            users = {s.user for s in sessions}
            self.assertIn("u1", users)
            self.assertNotIn("u2", users)  # too few move events -> filtered out

            X, y = stack_windows(sessions)
            self.assertEqual(X.shape[1], N_FEATURES)
            self.assertTrue(np.all(np.isfinite(X)))
            self.assertGreater(X.shape[0], 0)

    def test_max_rows_and_max_users_truncate_without_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dataset_cleaned4.csv"
            _make_csv(path)
            limited = load_csv_sessions(path, max_rows=10, verbose=False)
            one_user = load_csv_sessions(path, max_users=1, verbose=False)
            self.assertLessEqual(len({s.user for s in one_user}), 1)
            # both calls must complete and return a (possibly empty) list, not raise
            self.assertIsInstance(limited, list)

    def test_cache_roundtrip_matches_direct_load(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "dataset_cleaned4.csv"
            _make_csv(path)
            cache_path = Path(tmp) / "cache.npz"

            direct = load_csv_sessions(path, verbose=False)
            cached_first = load_csv_sessions_cached(path, cache_path=cache_path, verbose=False)
            cached_second = load_csv_sessions_cached(path, cache_path=cache_path, verbose=False)

            Xd, _ = stack_windows(direct)
            Xc1, _ = stack_windows(cached_first)
            Xc2, _ = stack_windows(cached_second)
            np.testing.assert_allclose(Xc1, Xd)
            np.testing.assert_allclose(Xc2, Xd)


if __name__ == "__main__":
    unittest.main()
