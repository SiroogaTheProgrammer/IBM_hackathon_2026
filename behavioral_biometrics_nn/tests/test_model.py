"""Tests for the encoder and the per-user risk scorer."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from behavioral_biometrics_nn.encoder import (
    EMBEDDING_DIM,
    FeatureScaler,
    SiameseEncoder,
    batch_all_triplet_loss,
    batch_hard_triplet_loss,
    embed,
    load_base_model,
    mean_pairwise_distance,
    save_base_model,
    train_encoder,
)
from behavioral_biometrics_nn.scorer import (
    DISTANCE_FEATURES,
    N_DISTANCE_FEATURES,
    UserRiskModel,
    build_gallery_and_background,
    escalation_triggered,
    smooth_risk,
)


def _synthetic_users(n_users=4, per_user=120, dim=32, seed=0):
    rng = np.random.default_rng(seed)
    centers = rng.normal(0, 3.0, size=(n_users, dim))
    X = np.concatenate([centers[i] + rng.normal(0, 0.4, (per_user, dim)) for i in range(n_users)])
    y = np.concatenate([np.full(per_user, f"user{i}", dtype=object) for i in range(n_users)])
    return X.astype(np.float32), y


class EncoderTests(unittest.TestCase):
    def test_output_is_128d_and_l2_normalised(self):
        model = SiameseEncoder()
        out = model(torch.randn(16, 32))
        self.assertEqual(out.shape, (16, EMBEDDING_DIM))
        norms = out.norm(dim=1).detach().numpy()
        np.testing.assert_allclose(norms, np.ones(16), atol=1e-5)

    def test_triplet_loss_is_zero_for_well_separated_clusters(self):
        emb = torch.tensor([[1.0, 0.0], [1.0, 0.0], [-1.0, 0.0], [-1.0, 0.0]])
        labels = torch.tensor([0, 0, 1, 1])
        self.assertAlmostEqual(float(batch_hard_triplet_loss(emb, labels, margin=0.2)), 0.0)

    def test_triplet_loss_is_positive_when_classes_overlap(self):
        emb = torch.tensor([[1.0, 0.0], [-1.0, 0.0], [1.0, 0.0], [-1.0, 0.0]])
        labels = torch.tensor([0, 0, 1, 1])
        self.assertGreater(float(batch_hard_triplet_loss(emb, labels, margin=0.2)), 0.0)

    def test_batch_all_loss_matches_hard_loss_on_separated_clusters(self):
        emb = torch.tensor([[1.0, 0.0], [1.0, 0.0], [-1.0, 0.0], [-1.0, 0.0]])
        labels = torch.tensor([0, 0, 1, 1])
        self.assertAlmostEqual(float(batch_all_triplet_loss(emb, labels, margin=0.2)), 0.0)

    def test_collapsed_embedding_is_detected(self):
        collapsed = np.tile(np.array([[1.0] + [0.0] * 127]), (50, 1)).astype(np.float32)
        self.assertLess(mean_pairwise_distance(collapsed), 1e-6)

    def test_training_does_not_collapse_embeddings(self):
        X, y = _synthetic_users()
        Xs = FeatureScaler().fit_transform(X)
        model = train_encoder(Xs, y, epochs=5, steps_per_epoch=20, users_per_batch=4,
                              windows_per_user=8, verbose=False)
        self.assertGreater(mean_pairwise_distance(embed(model, Xs)), 0.05)

    def test_training_separates_synthetic_users(self):
        X, y = _synthetic_users()
        scaler = FeatureScaler()
        Xs = scaler.fit_transform(X)
        model = train_encoder(Xs, y, epochs=5, steps_per_epoch=20, users_per_batch=4,
                              windows_per_user=8, verbose=False)
        emb = embed(model, Xs)

        users = sorted(set(y.tolist()))
        centroids = np.stack([emb[y == u].mean(axis=0) for u in users])
        centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)
        predicted = np.asarray(users)[np.argmax(emb @ centroids.T, axis=1)]
        self.assertGreater(float(np.mean(predicted == y)), 0.9)


class ScalerTests(unittest.TestCase):
    def test_constant_column_does_not_produce_nan(self):
        X = np.hstack([np.random.default_rng(0).normal(size=(50, 3)), np.zeros((50, 1))])
        Z = FeatureScaler().fit_transform(X.astype(np.float32))
        self.assertTrue(np.all(np.isfinite(Z)))
        self.assertTrue(np.all(np.abs(Z) <= 5.0))

    def test_scaler_roundtrip(self):
        X = np.random.default_rng(0).normal(size=(40, 32)).astype(np.float32)
        scaler = FeatureScaler().fit(X)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scaler.npz"
            scaler.save(path)
            np.testing.assert_allclose(
                FeatureScaler.load(path).transform(X), scaler.transform(X), rtol=1e-6
            )


class ArtifactTests(unittest.TestCase):
    def test_saved_base_model_reproduces_embeddings(self):
        X, y = _synthetic_users(per_user=40)
        scaler = FeatureScaler().fit(X)
        Xs = scaler.transform(X)
        model = train_encoder(Xs, y, epochs=2, steps_per_epoch=10, users_per_batch=4,
                              windows_per_user=8, verbose=False)
        before = embed(model, Xs)

        with tempfile.TemporaryDirectory() as tmp:
            save_base_model(tmp, model, scaler, before[:100], y[:100], meta={"note": "test"})
            enc2, scaler2, bank, bank_users, meta = load_base_model(tmp)
            np.testing.assert_allclose(embed(enc2, scaler2.transform(X)), before, atol=1e-6)
            self.assertEqual(bank.shape[0], 100)
            self.assertEqual(len(bank_users), 100)
            self.assertEqual(meta["note"], "test")

    def test_loading_missing_model_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                load_base_model(tmp)


class ScorerTests(unittest.TestCase):
    def setUp(self):
        X, self.y = _synthetic_users(seed=1)
        Xs = FeatureScaler().fit_transform(X)
        model = train_encoder(Xs, self.y, epochs=5, steps_per_epoch=20, users_per_batch=4,
                              windows_per_user=8, verbose=False)
        self.emb = embed(model, Xs)

    def test_genuine_windows_score_lower_than_impostors(self):
        gallery, calibration, background = build_gallery_and_background(
            self.emb, self.y, "user0", gallery_size=30, background_size=90
        )
        risk_model = UserRiskModel("user0", gallery).fit(background, calibration=calibration)

        genuine = risk_model.risk(self.emb[self.y == "user0"])
        impostor = risk_model.risk(self.emb[self.y != "user0"])
        self.assertLess(float(genuine.mean()), float(impostor.mean()))
        self.assertTrue(np.all((genuine >= 0) & (genuine <= 1)))

    def test_inputs_are_distance_only_not_raw_embedding(self):
        """A 128-D embedding plus ~30 positives memorises the gallery region."""
        gallery, _, _ = build_gallery_and_background(self.emb, self.y, "user0", 20, 60)
        inputs = UserRiskModel("user0", gallery)._build_inputs(self.emb[:5])
        self.assertEqual(inputs.shape, (5, N_DISTANCE_FEATURES))
        self.assertEqual(len(DISTANCE_FEATURES), N_DISTANCE_FEATURES)

    def test_calibration_sets_are_disjoint_from_gallery(self):
        gallery, calibration, _ = build_gallery_and_background(
            self.emb, self.y, "user0", gallery_size=20, background_size=60,
            calibration_size=40,
        )
        self.assertEqual(len(gallery), 20)
        self.assertGreater(len(calibration), 0)
        gallery_rows = {row.tobytes() for row in gallery}
        self.assertTrue(all(row.tobytes() not in gallery_rows for row in calibration))

    def test_calibrated_threshold_admits_most_genuine_traffic(self):
        gallery, calibration, background = build_gallery_and_background(
            self.emb, self.y, "user0", gallery_size=30, background_size=90
        )
        model = UserRiskModel("user0", gallery).fit(
            background, calibration=calibration, target_false_alarm=0.05
        )
        genuine = smooth_risk(model.risk(calibration))
        self.assertLessEqual(float(np.mean(genuine >= model.threshold)), 0.10)

    def test_threshold_defaults_when_no_calibration_given(self):
        gallery, _, background = build_gallery_and_background(self.emb, self.y, "user0", 20, 60)
        model = UserRiskModel("user0", gallery).fit(background)
        self.assertEqual(model.threshold, 0.80)

    def test_gallery_distance_features_exclude_self_match(self):
        gallery, _, _ = build_gallery_and_background(
            self.emb, self.y, "user0", gallery_size=20, background_size=60
        )
        risk_model = UserRiskModel("user0", gallery)
        loo = risk_model._build_inputs(gallery, leave_one_out=True)
        naive = risk_model._build_inputs(gallery)
        # naive min-distance to itself is 0; leave-one-out must be strictly larger
        self.assertAlmostEqual(float(naive[:, 0].max()), 0.0, places=6)
        self.assertGreater(float(loo[:, 0].min()), 0.0)

    def test_risk_before_fit_raises(self):
        gallery, _, _ = build_gallery_and_background(self.emb, self.y, "user0", 20, 60)
        with self.assertRaises(RuntimeError):
            UserRiskModel("user0", gallery).risk(self.emb[:5])


class SmoothingTests(unittest.TestCase):
    def test_smoothing_preserves_length(self):
        self.assertEqual(smooth_risk(np.arange(10.0), 5).shape, (10,))

    def test_smoothing_is_causal(self):
        """A live system can only average over windows it has already seen."""
        risk = np.array([0.0, 0.0, 0.0, 1.0, 1.0])
        out = smooth_risk(risk, 3)
        self.assertEqual(float(out[0]), 0.0)
        self.assertEqual(float(out[2]), 0.0)  # future spike must not leak backwards
        self.assertAlmostEqual(float(out[3]), 1 / 3, places=5)

    def test_smoothing_suppresses_isolated_spike(self):
        risk = np.array([0.1, 0.1, 0.99, 0.1, 0.1, 0.1])
        self.assertTrue(escalation_triggered(risk, 0.8, 1, smoothing=1))
        self.assertFalse(escalation_triggered(risk, 0.8, 1, smoothing=5))

    def test_smoothing_keeps_sustained_attack(self):
        risk = np.full(12, 0.95)
        self.assertTrue(escalation_triggered(risk, 0.8, 3, smoothing=5))

    def test_window_of_one_is_identity(self):
        risk = np.array([0.2, 0.9, 0.4])
        np.testing.assert_allclose(smooth_risk(risk, 1), risk, rtol=1e-6)


class EscalationTests(unittest.TestCase):
    def test_three_consecutive_spikes_trigger(self):
        self.assertTrue(escalation_triggered(np.array([0.1, 0.9, 0.85, 0.95]), 0.8, 3))

    def test_non_consecutive_spikes_do_not_trigger(self):
        self.assertFalse(escalation_triggered(np.array([0.9, 0.1, 0.9, 0.2, 0.9]), 0.8, 3))

    def test_empty_stream_does_not_trigger(self):
        self.assertFalse(escalation_triggered(np.array([]), 0.8, 3))


if __name__ == "__main__":
    unittest.main()
