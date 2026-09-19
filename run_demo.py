"""STEP 4 - run the interactive demo dashboard.

    python run_demo.py
    python run_demo.py --enable keystroke_v1 device_env_v1
    python run_demo.py --disable tab_navigation_v1
    python run_demo.py --gallery-mode rolling --warmup-size 15

Which addons run is controlled by addons.json; the flags above override it for
a single run without editing the file.
"""

from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from behavioral_biometrics_nn.modules import REGISTRY, build_engine, load_config  # noqa: E402
from behavioral_biometrics_nn.feature_extractor import WINDOW_SECONDS  # noqa: E402
from behavioral_biometrics_nn.pipeline import DEFAULT_ARTIFACTS  # noqa: E402
from demo.server import serve  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=str(ROOT / "addons.json"))
    parser.add_argument("--artifacts", default=str(ROOT / DEFAULT_ARTIFACTS))
    parser.add_argument("--enable", nargs="*", default=[], metavar="MODULE")
    parser.add_argument("--disable", nargs="*", default=[], metavar="MODULE")
    parser.add_argument("--gallery-mode", choices=("frozen", "rolling"), default=None)
    parser.add_argument("--warmup-size", type=int, default=None)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--list-modules", action="store_true")
    args = parser.parse_args()

    if args.list_modules:
        for plugin_id, cls in sorted(REGISTRY.items()):
            flag = " (base, always on)" if cls.is_base else ""
            print(f"  {plugin_id:<20} {cls.display_name}{flag}")
        return

    if not (Path(args.artifacts) / "encoder.pt").exists():
        raise SystemExit(
            f"No trained base model in {args.artifacts}.\n"
            "Run STEP 1 first:  python train_base_model.py --epochs 40"
        )

    config = load_config(args.config)
    if args.gallery_mode:
        config["session"]["gallery_mode"] = args.gallery_mode
    if args.warmup_size:
        config["session"]["warmup_size"] = args.warmup_size

    engine = build_engine(args.artifacts, config, enable=args.enable, disable=args.disable)

    print("\n  enabled modules:")
    for module in engine.describe():
        trigger = f", hard-trigger {module['hard_trigger']}" if module["hard_trigger"] else ""
        print(f"    - {module['plugin_id']:<20} weight {module['weight']}{trigger}")
    print(f"\n  warm-up: {config['session']['warmup_size']} windows "
          f"(~{config['session']['warmup_size'] * WINDOW_SECONDS:.0f} s), "
          f"gallery mode: {config['session']['gallery_mode']}")

    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        webbrowser.open(url)
    serve(engine, port=args.port)


if __name__ == "__main__":
    main()
