"""STEP 3 - hands-on test: enrol from some sessions, then score another one.

This is the runtime path the dashboard will use: the base model is frozen, the
user's gallery is built at login, and each 2 s window gets a risk score.

``--enroll`` accepts files, directories or glob patterns. Globs are expanded by
this script, so quoting them (or passing the folder) works on any shell::

    # same person -> risk should stay low
    python verify_session.py --enroll training_files/user12 --test test_files/user12/session_0032069206 --exclude-user user12

    # different person -> risk should spike and escalate
    python verify_session.py --enroll training_files/user12 --test test_files/user9/session_0048475757 --exclude-user user12
"""

from __future__ import annotations

import argparse
import glob
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.encoder import embed, load_base_model
from behavioral_biometrics_nn.feature_extractor import extract_session_windows
from behavioral_biometrics_nn.pipeline import DEFAULT_ARTIFACTS
from behavioral_biometrics_nn.scorer import (
    BACKGROUND_SIZE,
    ESCALATION_CYCLES,
    GALLERY_SIZE,
    SMOOTHING_WINDOW,
    UserRiskModel,
    escalation_triggered,
    smooth_risk,
)

ROOT = Path(__file__).resolve().parent


def resolve_session_paths(patterns: list[str]) -> list[Path]:
    """Expand globs and directories.

    PowerShell and cmd do not expand ``*`` before handing arguments to Python
    (bash does), so the expansion has to happen here for the same command line
    to work on every shell. Directories are accepted and expanded to their files.
    """
    resolved: list[Path] = []
    for pattern in patterns:
        matches = [Path(m) for m in glob.glob(pattern)] or [Path(pattern)]
        for match in matches:
            if match.is_dir():
                resolved.extend(sorted(p for p in match.iterdir() if p.is_file()))
            elif match.is_file():
                resolved.append(match)

    unique = sorted({p.resolve() for p in resolved})
    if not unique:
        raise SystemExit(f"No session files matched: {' '.join(patterns)}")
    return unique


def _windows(paths: list[Path]) -> np.ndarray:
    matrices = [extract_session_windows(p) for p in paths]
    matrices = [m for m in matrices if m.shape[0] > 0]
    if not matrices:
        raise SystemExit(f"No usable windows extracted from {len(paths)} file(s)")
    return np.concatenate(matrices, axis=0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enroll", nargs="+", required=True, help="session file(s) to enrol from")
    parser.add_argument("--test", required=True, help="session file to score")
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--exclude-user", default=None,
                        help="drop this user from the background bank (avoid self-contamination)")
    parser.add_argument("--gallery-size", type=int, default=GALLERY_SIZE)
    parser.add_argument("--threshold", type=float, default=None,
                        help="override the threshold calibrated at enrolment")
    parser.add_argument("--cycles", type=int, default=ESCALATION_CYCLES)
    parser.add_argument("--smoothing", type=int, default=SMOOTHING_WINDOW,
                        help="rolling-mean length in windows (1 = no smoothing)")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    encoder, scaler, background, background_users, _ = load_base_model(args.artifacts)
    rng = np.random.default_rng(args.seed)

    enroll_paths = resolve_session_paths(args.enroll)
    test_paths = resolve_session_paths([args.test])
    if len(test_paths) != 1:
        raise SystemExit(f"--test must resolve to exactly one file, got {len(test_paths)}")

    if args.exclude_user:
        keep = background_users != args.exclude_user
        if not keep.any():
            raise SystemExit(f"Background bank is empty after excluding {args.exclude_user!r}")
        background, background_users = background[keep], background_users[keep]

    # --- enrolment (cold start) ---
    enrol_emb = embed(encoder, scaler.transform(_windows(enroll_paths)))
    if enrol_emb.shape[0] < 2:
        raise SystemExit("Need at least 2 enrolment windows")
    gallery_n = min(args.gallery_size, len(enrol_emb))
    shuffled = enrol_emb[rng.permutation(len(enrol_emb))]
    gallery, calibration = shuffled[:gallery_n], shuffled[gallery_n:]

    bg_n = min(BACKGROUND_SIZE, len(background))
    bg = background[rng.choice(len(background), size=bg_n, replace=False)]
    model = UserRiskModel("enrolled", gallery).fit(
        bg, calibration=calibration, seed=args.seed, smoothing=args.smoothing
    )
    threshold = model.threshold if args.threshold is None else args.threshold

    # --- continuous scoring ---
    test_path = test_paths[0]
    test_emb = embed(encoder, scaler.transform(_windows([test_path])))
    raw_risk = model.risk(test_emb)
    risk = smooth_risk(raw_risk, args.smoothing)
    escalated = escalation_triggered(raw_risk, threshold, args.cycles, args.smoothing)
    spikes = int(np.count_nonzero(risk >= threshold))

    print(f"\nenrolled from : {len(enroll_paths)} session(s), {gallery_n} gallery vectors")
    print(f"calibrated on : {len(calibration)} held-out genuine windows")
    print(f"threshold     : {threshold:.3f}"
          f"{' (calibrated)' if args.threshold is None else ' (manual)'}")
    print(f"scoring       : {test_path.parent.name}/{test_path.name}")
    print(f"windows       : {len(risk)}  (~2 s each)")
    print(f"mean risk     : {risk.mean():.3f}   median: {np.median(risk):.3f}")
    print(f"spikes >= {threshold:.2f}: {spikes}/{len(risk)} ({spikes / len(risk):.1%})")

    print("\nfirst 30 windows (. = allow, ! = spike):")
    print("  " + "".join("!" if r >= threshold else "." for r in risk[:30]))

    verdict = "ESCALATE -> trigger 2FA / lock session" if escalated else "ALLOW -> session continues"
    print(f"\n{args.cycles} consecutive spikes? {escalated}   =>  {verdict}\n")


if __name__ == "__main__":
    main()
