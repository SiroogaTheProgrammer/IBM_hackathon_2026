"""STEP 1b - train the keystroke-dynamics extension's Siamese encoder.

Extension B (design_choices.txt FILE 4) is meant to add a *pretrained*
population-level embedding space for typing rhythm, exactly like the mouse
base model, instead of the purely-online z-score heuristic it shipped with
initially. This script trains that encoder on the "How We Type"-style keystroke
corpus under ``Keystrokes/files/`` and saves it to its own artifacts directory
(``artifacts/keystroke/`` by default) so :class:`behavioral_biometrics_nn.
modules.keystroke.KeystrokeModule` can load it independently of the mouse
model - late fusion, not a merged feature vector.

The corpus has ~168k participant files; ``--max-users`` (default 800) caps how
many are read so a default run finishes in a few minutes. Pass
``--max-users 0`` to use every file (slow, hours).

Examples:
    python train_keystroke_model.py
    python train_keystroke_model.py --max-users 2000 --epochs 40
    python train_keystroke_model.py --max-users 0 --refresh-cache
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.dataset import stack_windows
from behavioral_biometrics_nn.encoder import (
    FeatureScaler,
    embed,
    export_siamese_weights,
    mean_pairwise_distance,
    save_base_model,
    train_encoder,
)
from behavioral_biometrics_nn.keystroke_dataset import (
    MIN_KEYS_PER_WINDOW,
    N_KEYSTROKE_FEATURES,
    WINDOW_SECONDS,
    load_keystroke_sessions_cached,
)

ROOT = Path(__file__).resolve().parent
DEFAULT_ROOT = "Keystrokes/files"
DEFAULT_ARTIFACTS = "artifacts/keystroke"
DEFAULT_CACHE = "artifacts/keystroke/cache"
DEFAULT_EMBEDDING_DIM = 32
BACKGROUND_BANK_SIZE = 4000


def train_keystroke_model(
    root=DEFAULT_ROOT,
    artifacts_dir=DEFAULT_ARTIFACTS,
    cache_dir=DEFAULT_CACHE,
    epochs: int = 30,
    embedding_dim: int = DEFAULT_EMBEDDING_DIM,
    max_users: int | None = 800,
    max_sections_per_user: int | None = None,
    seed: int = 0,
    refresh_cache: bool = False,
    verbose: bool = True,
) -> Path:
    if verbose:
        print(f"[1/3] Loading + windowing keystroke files from {root} ...")
    cache_path = Path(cache_dir) / "keystroke_windows.npz" if cache_dir else None
    sessions = load_keystroke_sessions_cached(
        root,
        cache_path=cache_path,
        refresh=refresh_cache,
        max_users=max_users,
        max_sections_per_user=max_sections_per_user,
        verbose=verbose,
    )
    X_raw, y = stack_windows(sessions)
    if X_raw.shape[0] == 0:
        raise RuntimeError(f"No usable keystroke windows extracted from {root}")

    if verbose:
        print(
            f"[2/3] Training keystroke Siamese encoder on {X_raw.shape[0]} windows "
            f"from {len(sessions)} participants ..."
        )
    scaler = FeatureScaler().fit(X_raw)
    X = scaler.transform(X_raw)
    encoder = train_encoder(
        X, y, epochs=epochs, embedding_dim=embedding_dim, seed=seed, verbose=verbose
    )

    if verbose:
        print("[3/3] Saving keystroke base model + standalone weights ...")
    embeddings = embed(encoder, X)
    rng = np.random.default_rng(seed)
    bank_idx = rng.choice(
        len(embeddings), size=min(BACKGROUND_BANK_SIZE, len(embeddings)), replace=False
    )

    out = save_base_model(
        artifacts_dir,
        encoder,
        scaler,
        embeddings[bank_idx],
        np.asarray(y)[bank_idx],
        meta={
            "train_source": str(root),
            "n_train_windows": int(X_raw.shape[0]),
            "n_train_participants": len(sessions),
            "window_seconds": WINDOW_SECONDS,
            "min_keys_per_window": MIN_KEYS_PER_WINDOW,
            "n_features": N_KEYSTROKE_FEATURES,
            "epochs": epochs,
            "source_type": "keystroke_corpus",
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
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=str(ROOT / DEFAULT_ROOT), help="Keystrokes/files directory")
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--cache", default=str(ROOT / DEFAULT_CACHE))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--embedding-dim", type=int, default=DEFAULT_EMBEDDING_DIM)
    parser.add_argument(
        "--max-users", type=int, default=800,
        help="participant files to read, 0 = all ~168k (default 800)",
    )
    parser.add_argument(
        "--max-sections-per-user", type=int, default=0,
        help="typed sentences kept per participant, 0 = all",
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--refresh-cache", action="store_true")
    args = parser.parse_args()

    train_keystroke_model(
        root=args.root,
        artifacts_dir=args.artifacts,
        cache_dir=args.cache,
        epochs=args.epochs,
        embedding_dim=args.embedding_dim,
        max_users=args.max_users or None,
        max_sections_per_user=args.max_sections_per_user or None,
        seed=args.seed,
        refresh_cache=args.refresh_cache,
    )


if __name__ == "__main__":
    main()
