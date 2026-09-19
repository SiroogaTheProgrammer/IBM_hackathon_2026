"""Tests for the keystroke extension module (pretrained-embedding + legacy fallback)."""

from __future__ import annotations

import unittest

from behavioral_biometrics_nn.modules.base import STATUS_ACTIVE, STATUS_INACTIVE, STATUS_WARMING
from behavioral_biometrics_nn.modules.keystroke import KeystrokeModule


def _telemetry(n_keys: int = 10, correction: bool = False) -> dict:
    keys = [{"key": chr(97 + i % 26), "dwell": 0.08 + 0.001 * i, "flight": 0.09} for i in range(n_keys)]
    if correction and keys:
        keys[0]["key"] = "Backspace"
    return {"keys": keys}


class KeystrokeModulePretrainedTests(unittest.TestCase):
    """Uses the real artifacts/keystroke model trained by train_keystroke_model.py."""

    def setUp(self):
        self.module = KeystrokeModule()

    def test_loads_pretrained_model_when_available(self):
        self.assertIsNotNone(self.module.session)

    def test_reaches_active_status_after_warmup(self):
        last = None
        for _ in range(25):
            last = self.module.update(_telemetry())
        self.assertEqual(last.status, STATUS_ACTIVE)
        self.assertGreaterEqual(last.risk_score, 0.0)
        self.assertLessEqual(last.risk_score, 1.0)
        self.assertGreater(last.confidence, 0.0)

    def test_inactive_with_too_few_keys(self):
        result = self.module.update(_telemetry(n_keys=1))
        self.assertEqual(result.status, STATUS_INACTIVE)
        self.assertEqual(result.confidence, 0.0)

    def test_warming_status_before_gallery_is_full(self):
        result = self.module.update(_telemetry())
        self.assertEqual(result.status, STATUS_WARMING)
        self.assertEqual(result.confidence, 0.0)

    def test_reset_clears_session_state(self):
        for _ in range(25):
            self.module.update(_telemetry())
        self.module.reset()
        result = self.module.update(_telemetry())
        self.assertEqual(result.status, STATUS_WARMING)


class KeystrokeModuleLegacyFallbackTests(unittest.TestCase):
    """No pretrained model at this path -> pure online z-score fallback."""

    def setUp(self):
        self.module = KeystrokeModule(artifacts_dir="does/not/exist")

    def test_falls_back_when_no_pretrained_model(self):
        self.assertIsNone(self.module.session)

    def test_warms_up_then_scores(self):
        last = None
        for _ in range(6):  # 6 * 10 keys = 60 >= WARMUP_KEYS(40)
            last = self.module.update(_telemetry())
        self.assertEqual(last.status, STATUS_ACTIVE)
        self.assertGreaterEqual(last.risk_score, 0.0)
        self.assertLessEqual(last.risk_score, 1.0)

    def test_correction_keys_raise_risk(self):
        for _ in range(6):
            self.module.update(_telemetry())
        baseline = self.module.update(_telemetry())
        self.module.reset()
        for _ in range(6):
            self.module.update(_telemetry())
        with_corrections = self.module.update(_telemetry(correction=True))
        self.assertGreaterEqual(with_corrections.detail["error_rate_ratio"], baseline.detail["error_rate_ratio"])


if __name__ == "__main__":
    unittest.main()
