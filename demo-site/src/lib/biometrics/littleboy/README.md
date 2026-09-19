# `little_boy` — per-event mouse autoencoder (TensorFlow.js)

A direct TypeScript/tf.js port of `ML_Models/train_pipeline_1.py` +
`ML_Models/identity_detection_full.py`, running inside this site's Next.js Route
Handlers instead of a separate Python process.

Selectable from the widget's **Detection model** dropdown as `little_boy`.

## Why this exists next to `../autoencoder`

Both modules train a per-user autoencoder and use reconstruction error as the
impostor signal. They differ in **what a row is**:

| | `balabit_autoencoder` (`../autoencoder`) | `little_boy` (this module) |
| --- | --- | --- |
| row | one ~1 s window | one raw mouse event |
| features | 26 window dynamics (velocity/accel/jerk, curvature, tremor spectrum, …) | 13: `x, y, time_delta, button_*, state_*` |
| scaler | signed-log1p → standardise → clip | StandardScaler → clip |
| network | 26-64-32-**12**-32-64-26 | 13-32-16-**8**-16-32-13 |
| warm-up | 60 ticks (~60 s) | 90 ticks (~90 s) |

`little_boy` is the literal pipeline. `balabit_autoencoder` is what that pipeline
became after its per-event representation was found to track *how spread out a
user's coordinates were* more than *who they were*; it keeps the architecture
family and replaces the input. Having both means the two representations can be
compared live on the same session.

## Pipeline

```
raw mouse events (one row each)
   ──▶ [x, y, time_delta, button_{Left,NoButton,Right,Scroll},
                          state_{Down,Drag,Move,Pressed,Released,Up}]
   ──▶ StandardScaler (fit on the training split), clip ±5σ
   ──▶ 13 ─ 32 ─ 16 ─ 8 ─ 16 ─ 32 ─ 13   (Adam 1e-3, MSE)
   ──▶ per-row MSE ──▶ per-tick mean ──▶ z ──▶ sigmoid ──▶ risk
```

The column order reproduces `ML_Models/ML_Models/feature_cols_*.json` exactly,
and the vocabulary is fixed rather than derived per session — the same reason
`test_pipeline.py` back-fills missing dummy columns with zeros.

## Files

| File | Role |
| --- | --- |
| `features.ts` | events → per-event rows; the fixed one-hot vocabulary. |
| `scaler.ts` | StandardScaler (Welford) + the ±5σ clamp. |
| `model.ts` | The 32-16-8 autoencoder, layer-for-layer. |
| `train.ts` | Fit + block-level threshold calibration → `LittleBoyProfile`. |
| `score.ts` | Reconstruction error for a candidate session. |
| `liveEngine.ts` | The per-session warm-up → fit → score state machine. |
| `types.ts` | `LittleBoyProfile` — the tf.js equivalent of the `.pth` + `.json` + `.pkl` trio. |

`backend.ts` (tfjs-node with a pure-JS CPU fallback), `store.ts` (model ↔ base64
JSON) and `reconstructionError` are reused from `../autoencoder` — they are
representation-agnostic, and running two tfjs instances in one process would
corrupt the kernel registry.

## Live use

The engine captures for 90 ticks, featurising each tick as it arrives and
appending the packed rows to its Redis document, then trains inline in the tick
request that completes the warm-up — measured at 3.0 s for ~4 000 rows against
the local dev server, against ~33 ms for an ordinary warm-up tick. Subsequent
ticks are scored by mean reconstruction error.

State lives under `bio:littleboy:*`, separate from `bio:session:*` and
`bio:ae:*`, so switching engines in the dropdown resumes rather than restarts.
`Reset`/`Quit` clear all of them.

`z` is mapped to risk so the calibrated `mean + 3σ` cutoff lands on the UI's 0.8
threshold (`sigmoid(3 / 2.164) = 0.8`), which is why this engine reports the
fixed threshold rather than a fitted one. The panel's **Different user?** row
shows this model's own estimate, separate from composite risk.

## Two deviations from the Python original, and why

Both come from the same place: `train_pipeline_1.py` was written against
continuous recorded CSVs, and a live browser stream is neither continuous nor
scored in one lump.

**1. `time_delta` is capped and the standardised values are clamped.**
`StandardScaler` divides by the column's standard deviation. On an evenly
sampled capture `time_delta`'s deviation collapses — a steady 60 Hz pointer
gives σ ≈ 3e-4 s. One row spanning a pause then standardises to z ≈ 1.5e4 and
contributes ~2e7 to its squared error, against a genuine mean nearer 1e-4.
Measured, unclamped: that single row dominated the training gradient *and* sent
the live z-score to 480 000 on the genuine user's own data. The 5 s cap
(`features.ts`) plus the ±5σ clamp (`scaler.ts`) brought genuine z back to ≈ 0
and the cost of a pause down to +0.03 risk.

**2. The threshold is calibrated on tick-sized blocks, not single rows.**
`identity_detection_full.py` decides by comparing each impostor's error against
the *genuine* error — a number a live check does not have — so enrolment stores
an absolute cutoff instead. That cutoff has to be measured at the same
granularity it will be applied: a tick averages ~50 rows, and averaging n rows
shrinks the spread by √n, so a per-row σ understates every z by ~7×. `train.ts`
therefore calibrates on overlapping blocks of `blockRows` consecutive rows,
where the live engine passes the capture's own observed events-per-tick. The
per-row cutoff is kept as `rowCutoff` for the anomalous-row diagnostic.

Offline evaluation leaves `blockRows` at 1, which reproduces the Python
pipeline's per-row statistics.

## Scripts

```bash
npm run eval:littleboy      # genuine-vs-impostor matrix over training_files/ + test_files/
npx tsx scripts/littleBoyLive.ts   # replay a real session through the live engine
```

Both read the dataset from the repository root.

## Measured accuracy — read before relying on this

`scripts/evalLittleBoy.ts` trains one model per user on `training_files/` and
scores every user's `test_files/` data against every model, reporting the same
rank-comparison metric `identity_detection_full.py` prints: impostors scoring
above their genuine user, against a 50% baseline.

See `EVAL.md` in this directory for the current numbers.

That metric is generous — it compares each impostor against the genuine error,
which a live check does not have. The sibling module's README documents the
equal-error rate for the window representation (mean EER 45.2% per window,
42.9% at 60 windows, AUC 0.573) and notes that the repo's existing
siamese/metric-learning pipeline lands in the same band (AUC 0.622, EER 41.7%,
`artifacts/report.txt`). The ceiling here is the dataset and the feature set,
not the choice of reconstruction error.

Treat `error`/`z` as a relative signal to compare against a cohort, not as an
absolute gate, until the threshold is calibrated across multiple enrolment
sessions. In particular the cutoff is calibrated on a held-out tail of the *same*
sitting, and mouse behaviour drifts more between sessions than within one.
