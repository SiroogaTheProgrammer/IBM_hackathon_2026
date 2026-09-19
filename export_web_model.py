"""One-time export: dump the trained mouse encoder + scaler + a background
embedding sample to plain JSON so demo-site's Vercel functions can run
inference in TypeScript without bundling PyTorch (its CPU wheel is far too
large for a serverless function's size limit) or LightGBM.

Re-run this after retraining the base model:

    python export_web_model.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from behavioral_biometrics_nn.encoder import load_base_model
from behavioral_biometrics_nn.pipeline import DEFAULT_ARTIFACTS

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "demo-site" / "src" / "lib" / "biometrics" / "model"
BACKGROUND_SAMPLE = 300


def export_encoder(encoder, out_path: Path) -> None:
    layers = []
    for module in encoder.net:
        if hasattr(module, "weight"):
            layers.append({
                "w": module.weight.detach().cpu().numpy().tolist(),
                "b": module.bias.detach().cpu().numpy().tolist(),
            })
    payload = {
        "input_dim": encoder.input_dim,
        "embedding_dim": encoder.embedding_dim,
        "layers": layers,
    }
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)} ({len(layers)} linear layers)")


def export_scaler(scaler, out_path: Path) -> None:
    payload = {
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "clip": scaler.clip,
    }
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)}")


def export_background(background: np.ndarray, out_path: Path, seed: int = 0) -> None:
    rng = np.random.default_rng(seed)
    n = min(BACKGROUND_SAMPLE, len(background))
    idx = rng.choice(len(background), size=n, replace=False)
    payload = {"vectors": background[idx].astype(np.float32).tolist()}
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)} ({n} vectors)")


def main() -> None:
    encoder, scaler, background, _background_users, meta = load_base_model(DEFAULT_ARTIFACTS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"exporting mouse base model (input_dim={meta['input_dim']}, "
          f"embedding_dim={meta['embedding_dim']}) -> {OUT_DIR}")
    export_encoder(encoder, OUT_DIR / "mouseEncoder.json")
    export_scaler(scaler, OUT_DIR / "mouseScaler.json")
    export_background(background, OUT_DIR / "mouseBackground.json")


if __name__ == "__main__":
    main()
