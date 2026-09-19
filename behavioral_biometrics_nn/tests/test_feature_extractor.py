"""Tests for the 32-feature extractor, run against real session files."""

from __future__ import annotations

import math
import unittest
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.feature_extractor import (
    FEATURE_NAMES,
    N_FEATURES,
    Event,
    extract_session_windows,
    extract_window_features,
    read_session_events,
    segment_windows,
)

REPO = Path(__file__).resolve().parents[2]
SESSION = REPO / "training_files" / "user12" / "session_2144641057"


class ParsingTests(unittest.TestCase):
    def test_reads_real_events_with_correct_header(self):
        events = read_session_events(SESSION)
        self.assertGreater(len(events), 100)
        first = events[0]
        self.assertEqual(first.state, "Move")
        self.assertEqual(first.button, "NoButton")
        self.assertEqual((first.x, first.y), (1043.0, 410.0))

    def test_events_are_time_ordered(self):
        times = [e.t for e in read_session_events(SESSION)]
        self.assertTrue(all(b >= a for a, b in zip(times, times[1:])))

    def test_windows_respect_duration_limit(self):
        windows = segment_windows(read_session_events(SESSION), window_seconds=2.0)
        self.assertGreater(len(windows), 5)
        for window in windows:
            self.assertLessEqual(window[-1].t - window[0].t, 2.0 + 1e-6)


class FeatureTests(unittest.TestCase):
    def test_vector_has_32_finite_values(self):
        matrix = extract_session_windows(SESSION)
        self.assertEqual(matrix.shape[1], N_FEATURES)
        self.assertEqual(len(FEATURE_NAMES), N_FEATURES)
        self.assertTrue(np.all(np.isfinite(matrix)))

    def test_features_are_not_all_zero(self):
        """Guards the header-parsing bug that silently produced all-zero vectors."""
        matrix = extract_session_windows(SESSION)
        self.assertGreater(matrix.shape[0], 0)
        nonzero_columns = np.count_nonzero(np.any(matrix != 0, axis=0))
        self.assertGreaterEqual(nonzero_columns, 20)

    def test_straight_line_is_efficient_and_has_known_velocity(self):
        window = [
            Event(t=i * 0.1, button="NoButton", state="Move", x=100.0 + 10.0 * i, y=50.0)
            for i in range(12)
        ]
        features = dict(zip(FEATURE_NAMES, extract_window_features(window)))
        self.assertAlmostEqual(features["path_efficiency"], 1.0, places=5)
        self.assertAlmostEqual(features["v_mean"], 100.0, places=3)  # 10 px / 0.1 s
        self.assertEqual(features["dir_changes_x"], 0.0)
        self.assertAlmostEqual(features["total_curvature"], 0.0, places=6)

    def test_zigzag_counts_direction_changes(self):
        window = [
            Event(t=i * 0.1, button="NoButton", state="Move", x=100.0 + (10.0 if i % 2 else -10.0), y=50.0 + i)
            for i in range(12)
        ]
        features = dict(zip(FEATURE_NAMES, extract_window_features(window)))
        self.assertGreater(features["dir_changes_x"], 5)
        self.assertLess(features["path_efficiency"], 0.5)

    def test_click_dwell_and_pause_are_measured(self):
        window = [Event(t=0.0, button="Left", state="Pressed", x=10.0, y=10.0)]
        window += [
            Event(t=0.01 * i, button="NoButton", state="Move", x=10.0 + i, y=10.0)
            for i in range(1, 11)
        ]
        window.append(Event(t=0.25, button="Left", state="Released", x=20.0, y=10.0))
        window += [
            Event(t=0.8 + 0.01 * i, button="NoButton", state="Move", x=30.0 + i, y=10.0)
            for i in range(10)
        ]
        features = dict(zip(FEATURE_NAMES, extract_window_features(window)))
        self.assertAlmostEqual(features["click_dwell_mean"], 0.25, places=3)
        self.assertEqual(features["pause_count"], 1.0)  # the 0.1 -> 0.8 s gap
        self.assertGreater(features["pause_ratio"], 0.0)

    def test_scroll_direction_changes(self):
        window = [
            Event(t=0.01 * i, button="NoButton", state="Move", x=10.0 + i, y=10.0)
            for i in range(10)
        ]
        window += [
            Event(t=0.2, button="Scroll", state="Up", x=20.0, y=10.0),
            Event(t=0.4, button="Scroll", state="Down", x=20.0, y=10.0),
            Event(t=0.6, button="Scroll", state="Up", x=20.0, y=10.0),
        ]
        features = dict(zip(FEATURE_NAMES, extract_window_features(window)))
        self.assertEqual(features["scroll_direction_changes"], 2.0)
        self.assertGreater(features["scroll_speed_mean"], 0.0)

    def test_sinusoidal_tremor_peaks_at_expected_frequency(self):
        freq = 10.0
        window = [
            Event(
                t=i / 100.0,
                button="NoButton",
                state="Move",
                x=500.0 + 5.0 * math.sin(2 * math.pi * freq * i / 100.0),
                y=300.0,
            )
            for i in range(200)
        ]
        features = dict(zip(FEATURE_NAMES, extract_window_features(window)))
        self.assertAlmostEqual(features["fft_peak_freq_x"], freq, delta=1.0)
        self.assertGreater(features["tremor_band_energy"], 0.5)

    def test_empty_window_is_all_zero(self):
        features = extract_window_features([])
        self.assertEqual(features.shape, (N_FEATURES,))
        self.assertTrue(np.all(features == 0))


if __name__ == "__main__":
    unittest.main()
