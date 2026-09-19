"""STEP 1 - train the generic Siamese base model on training_files.

This is the user-agnostic encoder. Run it once; the result is reused for every
user. Artifacts are written to ``artifacts/``.

    python train_base_model.py
    python train_base_model.py --epochs 60 --refresh-cache
"""

from __future__ import annotations

import argparse
from pathlib import Path

from behavioral_biometrics_nn.pipeline import DEFAULT_ARTIFACTS, DEFAULT_CACHE, train_base_model

ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-root", default=str(ROOT / "training_files"))
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--cache", default=str(ROOT / DEFAULT_CACHE))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--max-sessions", type=int, default=0, help="per user (0 = all)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--refresh-cache", action="store_true")
    args = parser.parse_args()

    train_base_model(
        train_root=args.train_root,
        artifacts_dir=args.artifacts,
        cache_dir=args.cache,
        epochs=args.epochs,
        max_sessions_per_user=args.max_sessions or None,
        seed=args.seed,
        refresh_cache=args.refresh_cache,
    )


if __name__ == "__main__":
    main()
