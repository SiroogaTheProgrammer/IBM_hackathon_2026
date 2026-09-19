"""Export the trained bundle for TensorFlow.js, plus fixtures for a parity test.

Two artefacts:
  sapimouse-encoder.json  weights (base64 float32), preprocessor, configs, thresholds
  sapimouse-parity.json   raw sessions + the features/embeddings Python computes
                          from them, so the TypeScript port can be checked against
                          the implementation the numbers were measured with
"""
from __future__ import annotations

import base64, json, sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from mouse_auth import (MouseAuth, load_session, process_frame, filter_strokes,   # noqa: E402
                        apply_preprocessor, Config, PrepConfig, replace)

BUNDLE = Path(sys.argv[1] if len(sys.argv) > 1 else "data/models/sapimouse_deploy")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else
           "../demo-site/src/lib/biometrics/sapimouse/model")
OUT.mkdir(parents=True, exist_ok=True)

auth = MouseAuth.load(BUNDLE, device="cpu")
sd = {k: v.cpu().numpy().astype(np.float32) for k, v in auth.enc.state_dict().items()}


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=np.float32).tobytes()).decode()


def tensor(name):
    a = sd[name]
    return {"shape": list(a.shape), "data": b64(a)}


# nn.Linear stores (out, in); the TS side does x @ W^T + b, so ship W as-is
weights = {n: tensor(n) for n in sd}

pre = auth.pre
model = {
    "format": "sapimouse-encoder-v1",
    "note": "weights are base64 little-endian float32, row-major, shapes as given",
    "n_features": int(len(pre["features"])),
    "features": list(pre["features"]),
    "n_strokes": int(auth.mcfg.n_strokes),
    "stride": int(auth.mcfg.stride),
    "d_embed": int(auth.mcfg.d_embed),
    "d_hidden": int(auth.mcfg.d_hidden),
    "n_layers": int(auth.mcfg.n_layers),
    "pool": auth.mcfg.pool,
    "cfg": {k: v for k, v in auth.cfg.__dict__.items()},
    "pcfg": {k: v for k, v in auth.pcfg.__dict__.items()},
    "thresholds": auth.thresholds,
    "meta": auth.meta,
    "preprocess": {
        "features": list(pre["features"]),
        "log_cols": list(pre["log_cols"]),
        "lo": {k: float(v) for k, v in pre["lo"].items() if k in pre["features"]},
        "hi": {k: float(v) for k, v in pre["hi"].items() if k in pre["features"]},
        "fill": {k: float(v) for k, v in pre["fill"].items() if k in pre["features"]},
        "center": {k: float(v) for k, v in pre["center"].items() if k in pre["features"]},
        "scale": {k: float(v) for k, v in pre["scale"].items() if k in pre["features"]},
    },
    "weights": weights,
}
p = OUT / "sapimouse-encoder.json"
p.write_text(json.dumps(model))
print(f"[export] {p}  ({p.stat().st_size/1e6:.2f} MB, {len(weights)} tensors)")

# ---------------------------------------------------------------------------
# parity fixtures
# ---------------------------------------------------------------------------
DATA = Path("data/sapimouse")
picks = []
for u in ("user3", "user17", "user41"):
    fs = sorted((DATA / u).glob("session_*.csv"))
    if fs:
        picks.append((u, fs[0]))

cases = []
for u, f in picks:
    raw = load_session(f)
    st, qc, _ = process_frame(raw, "probe", "probe",
                              replace(auth.cfg, verbose=False), auth.pcfg, keep_seqs=False)
    st = filter_strokes(st, auth.pcfg, verbose=False).reset_index(drop=True)
    V = apply_preprocessor(st, auth.pre).to_numpy(dtype=np.float32)
    n = auth.mcfg.n_strokes
    idx = [np.arange(e - n, e) for e in range(n, len(st) + 1, auth.mcfg.stride)]
    X = torch.from_numpy(np.stack([V[i] for i in idx]))
    with torch.no_grad():
        Z = auth.enc(X, None).numpy()
    # dump the CSV as captured, in MILLISECONDS, so the fixture exercises the
    # unit conversion too -- feeding pre-converted seconds would hide exactly the
    # class of bug that is hardest to notice downstream
    import pandas as _pd
    ev = _pd.read_csv(f)
    ev.columns = [c.strip().lower() for c in ev.columns]
    cases.append({
        "user": u, "file": f.name, "t_unit": "milliseconds",
        "events": {"t": [float(v) for v in ev["client timestamp"]],
                   "button": [str(v) for v in ev["button"]],
                   "state": [str(v) for v in ev["state"]],
                   "x": [float(v) for v in ev["x"]],
                   "y": [float(v) for v in ev["y"]]},
        "n_strokes": int(len(st)),
        "raw_features": {c: [None if (isinstance(v, float) and np.isnan(v)) else float(v)
                             for v in st[c]] for c in auth.pre["features"]},
        "scaled": [[float(v) for v in row] for row in V],
        "embeddings": [[float(v) for v in row] for row in Z],
        "session_embedding": [float(v) for v in
                              (Z.mean(0) / np.linalg.norm(Z.mean(0)))],
    })
    print(f"[fixture] {u}/{f.name}: {len(ev)} events -> {len(st)} strokes -> {len(Z)} windows")

q = OUT / "sapimouse-parity.json"
q.write_text(json.dumps({"cases": cases}))
print(f"[export] {q}  ({q.stat().st_size/1e6:.2f} MB, {len(cases)} cases)")

# ---------------------------------------------------------------------------
# impostor background for the live risk model
# ---------------------------------------------------------------------------
# `fitRiskModel` needs examples of what "somebody else" looks like against a
# gallery. The demo has no impostors to hand, so ship a fixed pool of window
# embeddings from a spread of SapiMouse users. Drawn from the held-out
# calibration users where possible, so nothing in the pool is a user the
# encoder was fitted on.
rng = np.random.default_rng(0)
held_out = list(auth.meta.get("calibration_users") or [])
all_users = sorted((DATA).glob("user*"), key=lambda p: int("".join(c for c in p.name if c.isdigit())))
pool_users = [p for p in all_users if p.name in held_out] or all_users
pool_users = [pool_users[i] for i in rng.permutation(len(pool_users))[:40]]

vecs = []
for ud in pool_users:
    for f in sorted(ud.glob("session_*.csv")):
        try:
            z = auth._windows(f)
        except Exception:
            continue
        vecs.append(z)
Z = np.concatenate(vecs) if vecs else np.zeros((0, auth.mcfg.d_embed), np.float32)
keep = rng.permutation(len(Z))[:300]
bg = Z[keep]
r = OUT / "sapimouse-background.json"
r.write_text(json.dumps({
    "note": "impostor window embeddings for fitRiskModel; users held out of training",
    "n_users": len(pool_users),
    "vectors": [[float(v) for v in row] for row in bg],
}))
print(f"[export] {r}  ({len(bg)} vectors x {bg.shape[1]}d from {len(pool_users)} users, "
      f"{r.stat().st_size/1e6:.2f} MB)")
