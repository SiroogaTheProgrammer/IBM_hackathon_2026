# Mouse-dynamics autoencoder (TensorFlow.js)

A TypeScript port of `ML_Models/train_pipeline_1.py` + `ML_Models/identity_detection_full.py`,
running in this site's Next.js Route Handlers instead of a separate Python process.

## How it works

One autoencoder is trained **per user**, on that user's mouse events only. Because it
never sees anyone else, it learns to reconstruct its owner's event distribution well
and everyone else's badly. The mean reconstruction error is the impostor signal.

```
~1 s window of events
   ──▶ 26 dynamics features (velocity/accel/jerk, path geometry, curvature,
       click rhythm, pauses, tremor spectrum, scroll) via ../featureExtractor
   ──▶ signed-log1p, standardise, clip (per-user)
   ──▶ 26 ─ 64 ─ 32 ─ 12 ─ 32 ─ 64 ─ 26   (~8.5k parameters)
   ──▶ per-window MSE ──▶ mean + fraction of windows over the cutoff
```

Window length matches `BiometricsWidget`'s `TICK_MS = 1000`, so the model trains
on the same window shape it is asked to score live. The cutoff is calibrated at
enrolment on a held-out **chronological** tail of the user's own data:
`mean + 3σ` of the genuine per-window error. The split is chronological
rather than random because consecutive mouse events are near-duplicates — a random
split leaks the validation rows into training and produces an over-tight threshold.

## Files

| File | Role |
| --- | --- |
| `features.ts` | CSV / live events → ~1 s windows → 26-feature matrix. |
| `scaler.ts` | signed-log1p + standardise + clip (Welford, single pass). |
| `model.ts` | Model definition + chunked reconstruction-error computation. |
| `train.ts` | Fit + threshold calibration → `UserProfile`. |
| `score.ts` | Score a session against a profile. |
| `store.ts` | Model ↔ JSON (base64 weights) so a profile fits in Redis. |
| `profileStore.ts` | Redis-backed profile persistence, in-memory fallback. |
| `backend.ts` | Picks `tfjs-node` (native) or falls back to pure-JS CPU. |
| `dataset.ts` | Dataset loader for the offline scripts only. |

## Live use in the demo site

The widget's **Detection model** dropdown picks which mouse model scores the
session:

| option | path |
| --- | --- |
| `balabit_features_embed` | the original: 32 window features → trained siamese encoder → gallery distance |
| `balabit_autoencoder` | this module: 26 window features → per-session autoencoder → reconstruction error |
| `little_boy` | `../littleboy`: the literal `train_pipeline_1.py` port — one row per raw event, 32-16-8 bottleneck → reconstruction error |

Selecting one runs the real thing — there is no precomputed model. The
autoencoder engine captures raw events for 60 ticks (~1 min), re-windows the
whole capture, trains, and calibrates a cutoff, all inside the tick request
that completes the warm-up (~800 ms locally). Subsequent ticks are scored by
reconstruction error.

Only the mouse module is swapped; tab-navigation and keystroke run identically
either way, so composite risk stays comparable between them. Each engine keeps
its own warm-up state (`bio:session:*`, `bio:ae:*`, `bio:littleboy:*`), so
switching back resumes rather than restarting. `Reset`/`Quit` clear all of them.

The autoencoder's `z` is mapped to risk so its calibrated `mean + 3σ` cutoff
lands exactly on the UI's 0.8 threshold, which is why that engine reports a
fixed threshold while the embedding engine reports its own fitted one.

A 60 s capture yields only ~60 non-overlapping windows, so enrolment
oversamples with a 0.25 s hop (`ENROL_HOP_SECONDS`) for ~4x the rows. Those
rows are correlated — the effective sample size is still nearer 60 than 240,
and the live model is correspondingly noisier than the offline one below.

## Endpoints

- `POST /api/biometrics/autoencoder/enrol` — `{ userId, events[], epochs?, batchSize? }` → trains and stores a profile.
- `POST /api/biometrics/autoencoder/score` — `{ userId, events[] }` → `{ error, z, anomalousRowFraction, isImpostor }`.

`enrol` is CPU-bound and takes seconds; it sets `maxDuration = 300`. If your host caps
request duration below the training time, move enrolment to a queue/worker rather than
raising epochs on the request path.

## Scripts

```bash
npx tsx scripts/benchAutoencoder.ts    # training/inference cost on this machine
npx tsx scripts/evalAutoencoder.ts     # genuine-vs-impostor matrix over the dataset
```

Both read `training_files/` and `test_files/` from the repository root.

## Differences from the Python version

- **Window features instead of per-event rows.** See "Measured accuracy" below.
- **Bigger batches.** The Python default (`batch_size=32`) is almost pure per-step
  overhead on a model this small. See the benchmark.
- **Calibrated threshold.** `identity_detection_full.py` decides by comparing each
  impostor's error against the *genuine* error — which a live system does not have.
  Enrolment stores an absolute cutoff instead.

## Measured accuracy — read before relying on this

`scripts/evalAutoencoder.ts` trains one model per user on `training_files/` and
scores every user's `test_files/` data against every model.

**Rank-comparison metric** (the one `identity_detection_full.py` uses): impostors
scoring above their genuine user, 69/90 = **76.7%** against a 50% baseline. That
metric is generous — it compares each impostor against the genuine error, which a
live check does not have.

**Equal error rate**, the metric a deployed per-user threshold actually faces:

| observation | 1 window (~1 s) | 10 w | 30 w | 60 w |
| --- | --- | --- | --- | --- |
| mean EER | 45.2% | 44.4% | 44.0% | **42.9%** |

Mean per-window AUC is **0.573** (0.5 = chance). Longer observation helps only
slightly, and for `user16`/`user29` the EER sits at or *above* chance no matter
how long you watch. Only `user7` (EER 29.5% @ 60 w, AUC 0.692) is usefully
separable.

### How this compares to the rest of the repo

`artifacts/report.txt` records the existing siamese/metric-learning pipeline on
the same users: mean per-window **AUC 0.622, EER 41.7%**, closed-set
identification accuracy 0.208.

So this autoencoder (AUC 0.573, EER 45.2% per window; 42.9% at 60 windows) lands
in the same band as the discriminatively-trained model already in the repo. The
reconstruction-error approach is not the thing holding accuracy back — **the
ceiling is the dataset and the feature set**, and both approaches hit it.

### What the window features did fix

The first version of this module fed one vector per raw event
(`[x, y, time_delta, button, state]`). It scored 64.4% on the rank metric, and
the owner's own model was the lowest-error model for only 2 of 10 users —
the error was tracking how spread out a user's coordinates were, not identity.
Switching to the 26 window-dynamics features raised that to 76.7% and 4 of 10.
Real improvement, but not enough to make the absolute threshold reliable.

That per-event representation now lives on as its own engine in
`../littleboy`, kept faithful to `train_pipeline_1.py` so the two encodings can
be compared on the same live session rather than only in an offline script.

### The absolute cutoff does not survive a session change

Enrolling `user7` on one slice of their training sessions and then scoring their
*test* sessions gives a mean error of 0.996 against a calibrated cutoff of 0.261 —
the genuine user is flagged harder than either impostor tried. The `mean + 3σ`
cutoff is calibrated on a held-out tail of the *same* sitting, and mouse
behaviour drifts more between sessions than it does within one.

Treat `error`/`z` as a relative signal to compare against a cohort, not as an
absolute gate, until the threshold is calibrated across multiple enrolment
sessions.

### If you want to push further

Neither more epochs nor a bigger network will move this — both models already
converge. The levers that would matter:

- **More enrolment data per user.** 7–27k windows per user here, from sessions
  recorded in one sitting; cross-day variation is not represented at all.
- **Score normalisation against a cohort.** Raw reconstruction error is not
  comparable across users — the error matrix has strong column structure, where
  some users' data is intrinsically harder for *every* model. `distanceStats.ts`
  and `mouseBackground.json` already do this for the siamese path.
- **Task context.** Window features still confound *what the user was doing*
  with *who they are*. Conditioning on UI context is the standard fix.
