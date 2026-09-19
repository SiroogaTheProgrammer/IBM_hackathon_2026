"""Tests for the Keystrokes/files corpus -> windowed keystroke-feature pipeline."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.keystroke_dataset import (
    N_KEYSTROKE_FEATURES,
    load_keystroke_sessions,
)

HEADER = "PARTICIPANT_ID\tTEST_SECTION_ID\tSENTENCE\tUSER_INPUT\tKEYSTROKE_ID\tPRESS_TIME\tRELEASE_TIME\tLETTER\tKEYCODE"


def _row(pid, section, ks_id, press, release, letter, keycode=65):
    return f"{pid}\t{section}\thello\thello\t{ks_id}\t{press}\t{release}\t{letter}\t{keycode}"


def _make_participant_file(path: Path, participant: str = "1") -> None:
    lines = [HEADER]
    # section 1: 8 keys, ~120 ms apart -> one dense 1s window with >= 4 keys
    press = 1_000_000.0
    for i in range(8):
        lines.append(_row(participant, "100", 1000 + i, press, press + 80, chr(97 + i)))
        press += 120.0
    # section 2: 2 keys only -> below MIN_KEYS_PER_WINDOW, must be dropped
    lines.append(_row(participant, "200", 2000, 5_000_000.0, 5_000_080.0, "x"))
    lines.append(_row(participant, "200", 2001, 5_000_200.0, 5_000_280.0, "y"))
    # section 3: includes a correction key
    press = 9_000_000.0
    for i in range(6):
        letter = "BKSP" if i == 3 else chr(97 + i)
        lines.append(_row(participant, "300", 3000 + i, press, press + 90, letter))
        press += 100.0
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class KeystrokeDatasetTests(unittest.TestCase):
    def test_builds_windows_with_correct_feature_width(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_participant_file(root / "1_keystrokes.txt", "1")
            sessions = load_keystroke_sessions(root, verbose=False)

            self.assertEqual(len(sessions), 1)
            session = sessions[0]
            self.assertEqual(session.user, "1")
            self.assertEqual(session.features.shape[1], N_KEYSTROKE_FEATURES)
            self.assertTrue(np.all(np.isfinite(session.features)))
            # section 2 (only 2 keys) must not contribute a window
            self.assertGreaterEqual(session.features.shape[0], 2)

    def test_short_section_is_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_participant_file(root / "1_keystrokes.txt", "1")
            sessions = load_keystroke_sessions(root, verbose=False, min_keys=4)
            total_keys_windows = sessions[0].features.shape[0]
            # only sections 100 and 300 (8 and 6 keys) can pass MIN_KEYS_PER_WINDOW=4
            self.assertEqual(total_keys_windows, 2)

    def test_correction_key_raises_error_rate_feature(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_participant_file(root / "1_keystrokes.txt", "1")
            sessions = load_keystroke_sessions(root, verbose=False)
            error_rates = sessions[0].features[:, 5]
            self.assertTrue(np.any(error_rates > 0.0))

    def test_malformed_rows_are_skipped_without_crashing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "2_keystrokes.txt"
            lines = [HEADER, _row("2", "1", 1, "NULL", "NULL", "a"), _row("2", "1", 2, 100.0, 90.0, "b")]
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            sessions = load_keystroke_sessions(root, verbose=False)
            self.assertEqual(sessions, [])  # no usable windows, but no crash

    def test_max_users_and_max_sections_truncate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _make_participant_file(root / "1_keystrokes.txt", "1")
            _make_participant_file(root / "2_keystrokes.txt", "2")
            sessions = load_keystroke_sessions(root, max_users=1, verbose=False)
            self.assertEqual(len(sessions), 1)

            sessions_capped = load_keystroke_sessions(
                root, max_users=1, max_sections_per_user=1, verbose=False
            )
            # only one section kept -> at most the windows from a single section
            self.assertLessEqual(sessions_capped[0].features.shape[0], 1)


if __name__ == "__main__":
    unittest.main()
