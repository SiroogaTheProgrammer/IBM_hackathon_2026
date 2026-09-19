"""STEP 1 - train the generic Siamese base model.

This script supports both the repository's session-based training files and a
large single CSV export containing raw mouse-movement rows. The trained encoder
and scaler are written under ``artifacts/`` so they can be loaded later for
inference without re-running the fit step, and a standalone weights-only file
(``artifacts/siamese_weights.pt``) is written alongside it for direct reuse.

Examples:
    python train_base_model.py
    python train_base_model.py --include-test-files --epochs 60
    python train_base_model.py --train-root training_files test_files
    python train_base_model.py --epochs 60 --refresh-cache
    python train_base_model.py --csv main_trainset/dataset_cleaned4.csv
    python train_base_model.py --csv main_trainset/dataset_cleaned4.csv --max-rows 200000
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.dataset import load_csv_sessions_cached, stack_windows
from behavioral_biometrics_nn.encoder import (
    FeatureScaler,
    embed,
    export_siamese_weights,
    mean_pairwise_distance,
    save_base_model,
    train_encoder,
)
from behavioral_biometrics_nn.pipeline import DEFAULT_ARTIFACTS, DEFAULT_CACHE, train_base_model

ROOT = Path(__file__).resolve().parent


def train_from_csv(
    csv_path,
    artifacts_dir=DEFAULT_ARTIFACTS,
    cache_dir=DEFAULT_CACHE,
    epochs: int = 30,
    seed: int = 0,
    user_col: str = "idman",
    max_rows: int | None = None,
    max_users: int | None = None,
    refresh_cache: bool = False,
    verbose: bool = True,
):
    """Train directly from a raw movement CSV export and persist the checkpoint.

    Rows are reconstructed into real per-user pointer trajectories and windowed
    with the same 32-feature extractor used for the session-file dataset (see
    :func:`behavioral_biometrics_nn.dataset.load_csv_sessions`), so this is a
    genuine equivalent of :func:`~behavioral_biometrics_nn.pipeline.train_base_model`
    for the single-CSV export format, not a naive column-to-feature mapping.
    """
    if verbose:
        print(f"[1/3] Loading + windowing CSV rows from {csv_path} ...")
    cache_path = Path(cache_dir) / "csv_train_windows.npz" if cache_dir else None
    sessions = load_csv_sessions_cached(
        csv_path,
        cache_path=cache_path,
        refresh=refresh_cache,
        user_col=user_col,
        max_rows=max_rows,
        max_users=max_users,
        verbose=verbose,
    )
    X_raw, y = stack_windows(sessions)
    if X_raw.shape[0] == 0:
        raise RuntimeError(f"No usable windows extracted from CSV: {csv_path}")

    if verbose:
        print(f"[2/3] Training generic Siamese encoder on {X_raw.shape[0]} windows "
              f"from {len(sessions)} users ...")
    scaler = FeatureScaler().fit(X_raw)
    X = scaler.transform(X_raw)
    encoder = train_encoder(X, y, epochs=epochs, seed=seed, verbose=verbose)

    if verbose:
        print("[3/3] Saving base model + standalone weights ...")
    embeddings = embed(encoder, X)
    rng = np.random.default_rng(seed)
    bank_idx = rng.choice(len(embeddings), size=min(4000, len(embeddings)), replace=False)

    out = save_base_model(
        artifacts_dir,
        encoder,
        scaler,
        embeddings[bank_idx],
        np.asarray(y)[bank_idx],
        meta={
            "train_source": str(csv_path),
            "n_train_windows": int(X_raw.shape[0]),
            "n_train_users": len(sessions),
            "train_users": sorted(set(y.tolist())),
            "epochs": epochs,
            "source_type": "csv",
            "embedding_spread": mean_pairwise_distance(embeddings),
        },
    )
    if verbose:
        print(f"  saved -> {out.resolve()}")

    weights_path = export_siamese_weights(encoder, Path(artifacts_dir) / "siamese_weights.pt")
    if verbose:
        print(f"  standalone weights -> {weights_path.resolve()}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--train-root", nargs="*", default=None, metavar="DIR",
        help="one or more session-file directories (default: training_files)",
    )
    parser.add_argument(
        "--include-test-files", action="store_true",
        help="also pool test_files/ into training (same users, far more sessions each)",
    )
    parser.add_argument("--csv", type=str, default="", help="CSV export path to train directly from")
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--cache", default=str(ROOT / DEFAULT_CACHE))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--max-sessions", type=int, default=0, help="per user (0 = all), training_files mode only")
    parser.add_argument("--max-rows", type=int, default=0, help="maximum CSV rows to read (0 = all)")
    parser.add_argument("--max-users", type=int, default=0, help="maximum distinct CSV users to load (0 = all)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--user-col", default="idman")
    parser.add_argument("--refresh-cache", action="store_true")
    args = parser.parse_args()

    if args.csv:
        train_from_csv(
            csv_path=args.csv,
            artifacts_dir=args.artifacts,
            cache_dir=args.cache,
            epochs=args.epochs,
            seed=args.seed,
            user_col=args.user_col,
            max_rows=args.max_rows or None,
            max_users=args.max_users or None,
            refresh_cache=args.refresh_cache,
        )
        return

    roots = list(args.train_root) if args.train_root else [str(ROOT / "training_files")]
    if args.include_test_files:
        roots.append(str(ROOT / "test_files"))
    train_root = roots[0] if len(roots) == 1 else roots
    cache_name = "train_windows.npz" if len(roots) == 1 else "train_windows_combined.npz"

    train_base_model(
        train_root=train_root,
        artifacts_dir=args.artifacts,
        cache_dir=args.cache,
        cache_name=cache_name,
        epochs=args.epochs,
        max_sessions_per_user=args.max_sessions or None,
        seed=args.seed,
        refresh_cache=args.refresh_cache,
    )


if __name__ == "__main__":
    main()
