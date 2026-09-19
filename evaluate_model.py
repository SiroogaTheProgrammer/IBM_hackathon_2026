"""STEP 2 - evaluate the saved base model on test_files.

Enrols every user from their ``training_files`` sessions (gallery + LightGBM),
then scores ``test_files``. Writes ``artifacts/metrics.json`` and
``artifacts/report.txt``.

    python evaluate_model.py
    python evaluate_model.py --max-test-sessions 30
"""

from __future__ import annotations

import argparse
from pathlib import Path

from behavioral_biometrics_nn.pipeline import (
    DEFAULT_ARTIFACTS,
    DEFAULT_CACHE,
    evaluate,
    format_report,
    save_evaluation,
)
from behavioral_biometrics_nn.scorer import GALLERY_SIZE, SMOOTHING_WINDOW

ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-root", default=str(ROOT / "training_files"))
    parser.add_argument("--test-root", default=str(ROOT / "test_files"))
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--cache", default=str(ROOT / DEFAULT_CACHE))
    parser.add_argument("--max-test-sessions", type=int, default=15, help="per user (0 = all)")
    parser.add_argument("--gallery-size", type=int, default=GALLERY_SIZE,
                        help="enrolment vectors held per user")
    parser.add_argument("--smoothing", type=int, default=SMOOTHING_WINDOW,
                        help="rolling-mean length in windows (1 = no smoothing)")
    parser.add_argument("--threshold", type=float, default=None,
                        help="override the per-user calibrated threshold")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--refresh-cache", action="store_true")
    args = parser.parse_args()

    result = evaluate(
        train_root=args.train_root,
        test_root=args.test_root,
        artifacts_dir=args.artifacts,
        cache_dir=args.cache,
        max_test_sessions_per_user=args.max_test_sessions or None,
        gallery_size=args.gallery_size,
        smoothing=args.smoothing,
        risk_threshold=args.threshold,
        seed=args.seed,
        refresh_cache=args.refresh_cache,
    )
    print(format_report(result))
    print(f"metrics saved -> {save_evaluation(result, args.artifacts)}")


if __name__ == "__main__":
    main()
