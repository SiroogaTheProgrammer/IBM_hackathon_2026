# big-boy-ts

Stroke encoder for continuous impostor detection, implemented end to end in
TypeScript against [`description.md`](../description.md).

Feature extraction, training and evaluation are all TypeScript. The encoder is
trained with `@tensorflow/tfjs-node` (native CPU kernels) and saved in the tfjs
LayersModel format, which the browser build loads directly — there is no Python
step and no model conversion, so the format that trains is the format that
ships.

**The point of the project.** The features the browser computes at test time and
the features the trainer computes at training time come from the *same compiled
code*, in `src/shared/`. §3.2 of the spec exists because a kinematic feature
computed on raw samples is a different signal at 17 ms (SapiMouse) than at 4 ms
(coalesced `pointermove`); a second implementation in another language is the
same failure one level up.

---

## Layout

```
src/
  shared/          browser-safe — no node built-ins, no bundler-hostile imports
    types.ts         InputEvent, Stroke, Scaler
    resample.ts      uniform 60 Hz grid                        §3.2
    strokes.ts       stroke segmentation                       §3.4
    features.ts      34 per-stroke features                    §4
    standardize.ts   fitted offline, applied in the browser    §5.1
    pipeline.ts      events → strokes → features (one path)
    embed.ts         encoder wrapper, pooling, cosine          §5.1
    score.ts         AS-norm, LLR, SPRT boundaries             §6
  node/
    sapimouse.ts     CSV → InputEvent, screen estimation
    augment.ts       trajectory-level augmentation             §5.4
    dataset.ts       feature cache, identity-disjoint splits    §5.5
  train/
    model.ts         256 → 256 → 128 MLP, BN + ReLU            §5.1
    aam.ts           additive angular margin softmax           §5.2
    train.ts         training loop
  eval/
    verify.ts        replay harness: EER, SPRT, ablations      §7
  cli.ts
```

## Data

`data/` is gitignored. Expected layout:

```
data/sapimouse/user1/session_2020_05_14_1min.csv
data/sapimouse/user1/session_2020_05_14_3min.csv
...
```

with columns `client timestamp,button,state,x,y`. 120 users, 245 sessions.

## Running it

```bash
npm install
npm run extract     # CSVs → stroke features, cached under cache/
npm run train       # AAM-softmax over the training identities
npm run eval        # replay held-out identities through the §6 backend
npm run calibrate   # fit §6.4 from runs recorded on the demo site
npm run export      # copy encoder + scaler into demo-site/public/
```

Roughly 2 s to extract, 100 s to train 40 epochs, 5 s to evaluate on this
machine. `node src/cli.ts --help` lists every flag.

```bash
npm test            # shared-code tests, incl. the browser-load round-trip
npm run typecheck
```

---

## Results

120 identities, 96 for training and 24 held out. Of the held-out identities,
half fit the backend (§6.4) and half are measured — so no identity is ever used
for both, per §5.5.

| | EER | impostor detection | false lockout | blocks to detect (median / p90) |
|---|---|---|---|---|
| AS-norm + accumulation | 16.0% | 78.8% | 8.3% | 2 / 7 |
| without AS-norm | 16.4% | 54.5% | 0.0% | 4 / 11 |
| without accumulation | 16.0% | 76.5% | 8.3% | 1 / 8 |

**AS-norm is the finding that holds.** It buys ~24 points of impostor detection
(78.8% vs 54.5%), and it reproduced across retrainings — §6.2 calls it "cheap to
implement, consistently large payoff", and that is what the harness sees.

**The accumulation row is not trustworthy at this sample size, and it moved.**
An earlier training run of the same configuration put the no-accumulation false
lockout at 33.3% against 8.3% for the full pipeline, which is a dramatic result
and the one worth wanting. On the shipped run they are identical. Twelve
evaluation identities means false lockout moves in steps of 8.3 points, so both
readings are consistent with each other and neither says much. Do not quote the
accumulation ablation from this table; §6.4's calibration collection is what
settles it.

That instability is itself the §7 point: false lockout rate "is the number that
kills the product if it is wrong, and the one to be most sceptical about". At
n = 12 it cannot be measured to better than ±8 points.

**Read these numbers with three caveats.**

1. **This is the text-independent setting.** SapiMouse has no task structure, so
   there is no `subtask_id` to align on and the comparison is "any block against
   any block". §2 identifies sub-task alignment as the single largest accuracy
   lever in the system, and none of it is in this table. Treat this as a lower
   bound and as a regression test on the encoder, not as a demo estimate.
2. **The evaluation set is 12 identities**, and `w` is fitted on twelve
   calibration runs, which is a coarse fit — the search requires zero lockouts
   among twelve genuine runs to accept a given `w`. The real calibration is
   §6.4's 15–20 users on the demo site.
3. **A "block" here is six strokes**, not a sub-task. Median detection in two
   blocks is roughly twelve strokes of mouse movement, not twelve sub-tasks.

---

## Calibration from demo runs (§6.4)

`npm run calibrate` reads `demo-site/data/collected/*.csv` — runs recorded by
real participants through the actual flow — and fits what that collection
supports. On the twelve runs collected so far:

```
12 runs, 12 subjects, viewport 1710x856
embedded 197/348 sub-task instances  (dropped 12 lost, 139 under two strokes)
cohort: 197 embeddings across 28 sub-task ids  (1–12 per id)
impostor comparisons  1440    z ~ N(-0.028, 1.332)
genuine comparisons      0    NOT FITTABLE
```

**Half of §6.4 is now real and half cannot be**, and the split is structural,
not a matter of effort:

| §6.4 product | State |
|---|---|
| 1. Genuine score distribution | **Not fittable.** Every participant recorded one run, so no same-person pair exists. |
| 2. Impostor score distribution | Fitted: 1440 comparisons over 12 subjects. |
| 3. Cohort embeddings per sub-task id | Shipped, 197 embeddings, 100 KB. This is the piece SapiMouse structurally cannot provide. |
| 4. Accumulation scale `w`, thresholds | **Not fittable** — §6.3 fits `w` so genuine runs cross the lower boundary at the intended rate. |
| 5. Per-sub-task d′ weights | **Not fittable** (needs both distributions). `betweenSubjectSimilarity` is reported instead. |

So `backend.json` ships `llr: null` and `thresholds: null`, and the demo reports
"no decision" while still showing the per-sub-task scores. Borrowing the
SapiMouse distributions would be worse than nothing: they were fitted under a
*different cohort*, so they live on a different z-scale — the measured demo
impostor is N(-0.03, 1.33) against SapiMouse's N(-10.9, 10.8).

**The AS-norm sanity check passes.** With a correct cohort the impostor
distribution should come out near N(0, 1) by construction, because the cohort
*is* impostors. Measured: N(-0.028, 1.332). The 1.33 rather than 1.0 is the
thin banks — several sub-tasks have fewer than four embeddings left after both
sides of a comparison are held out, so AS-norm falls through to the global bank.

### What the collection says about the flow (§6.4 item 5)

Calibration doubles as a design loop, and this one is blunt:

- **40% of sub-task instances produce no embedding** — 139 of 348 held fewer
  than two strokes. The flow is mostly single point-and-click hops, and §6.1's
  two-stroke minimum eliminates them. This is the finding to act on.
- **Sub-task 4.3 yielded zero usable embeddings across all twelve runs.** It is
  a menu item directly below its trigger: no free cursor movement, no strokes,
  no signal. §6.4 predicts exactly this ("usually the ones with short travel
  distance or no free cursor movement") and says to redesign or drop it.
- Nine more sub-tasks have banks too thin for AS-norm to engage: 1.3, 3.3, 2.1,
  2.5, 2.7, 1.5, 3.6, 4.5, 5.3.
- Separating best (lowest between-subject cosine, n ≥ 6): 5.4 (0.555), 5.6
  (0.569), 1.4 (0.579), 5.1 (0.579). Worst: 1.2 (0.810), 2.4 (0.800), 5.5
  (0.750) — long dwells where people mostly read rather than move.

### What one more collection round would unlock

A single repeat run from each participant — 12 × 3 min — turns items 1, 4 and 5
on: the genuine distribution, `w`, the operating thresholds, and real d′
weights. §6.4 asks for runs spaced apart (ideally ≥30 min) so within-user drift
is represented rather than hidden.

Two caveats to carry into that round. No familiarisation pass was discarded
here, and participants' prior familiarity with the real MyCourses app varies
widely, so think-time differences currently carry familiarity as well as
identity — §2.3's confound, uncontrolled. And the QC threshold (drop a sub-task
past max(12 s, 4× its median)) is a judgement call that removed 12 instances;
it is `--qc-multiple` / `--qc-floor` if you want to see the sensitivity.

---

## Deviations from `description.md`, and why

Four places where the implementation does something the spec does not say.

### 1. The encoder consumes only trajectory-intrinsic features

§4 lists target-relative features — Fitts residual against a known target width,
endpoint offset inside a bounding box, approach angle relative to the widget.
None are computable on a public dataset, because a public dataset has no DOM.

They are **not** padded with zeros. A constant column at training time that
becomes a live value at test time is worse than an absent one: the encoder
learns to ignore the column, and then the distribution shifts underneath it.

So `features.ts` computes the 34 intrinsic features, and target-relative signal
enters one layer up, in the §6 backend, where it is compared against the
enrolled template for the same `subtask_id`. The demo site's own extractor
already computes endpoint offset and approach angle for exactly that purpose.

### 2. Training classifies pooled bags, not single strokes

§5.1 pools per-stroke embeddings within a sub-task, and §5.2 applies AAM-softmax
over identities. Read literally that means classifying one stroke at a time.
That does not work here, and not for a reason that tuning fixes.

With 96 identities at `s = 30`, the degenerate solution — every embedding and
every class direction collapsed to a single point — scores a loss of
`log(95·e^(s(1−cos m)) + 1) ≈ 5.2`. The best achievable per-stroke solution on
this data sits near 7.2. Collapse is the genuine optimum, and the optimiser
finds it: loss falls while accuracy decays to chance, which looks like progress
in the log.

The fix is to apply the objective where the system actually uses the embedding —
to the pooled vector. Training draws a bag of 6 strokes from one session, encodes
each, mean-pools, and classifies that. Same two steps as `poolEmbeddings` at test
time. This is also what x-vector speaker-verification systems do, which §1 names
as the structural analogue: a frame-level encoder, statistics pooling, then the
margin head on the pooled vector. Nobody classifies single frames.

Result: 53.6% top-1 over 96 identities against a 1% chance rate, no collapse.
`--bag=1` restores literal per-stroke training if you want to watch it fail.

### 3. The margin is held at zero before it ramps

§5.2 says the margin is "warmed up over the first few epochs". Ramping from
epoch 0 still collapses the model — the margin starts biting while the encoder
is at 6% accuracy and has nothing to protect. `marginAt` holds `m = 0` for
`warmupEpochs`, then ramps linearly over the next `warmupEpochs`.

### 4. L2 normalisation lives outside the saved graph

§5.1 puts the length-normalisation in the encoder. A `Lambda`-style layer does
not survive a tfjs `save()`/`loadLayersModel()` round-trip, so the saved model
ends at the 128-d linear projection and `embed.ts` normalises in plain
TypeScript. The browser and the offline harness therefore run the same three
lines, which is stronger than trusting two graph serialisations to agree.

### Also worth knowing: screen size is estimated, not recorded

§3.3 says to make features viewport-invariant by normalising distances by the
viewport diagonal. SapiMouse ships no resolution metadata, and the observed
coordinate maxima across the 120 users range from ~900 px to ~2550 px wide, so a
single hard-coded resolution would mis-scale a third of the corpus.
`estimateScreen` takes a high percentile of each session's observed extent — over
one to three minutes of continuous mouse work the cursor sweeps most of the
usable area, which is the same quantity the demo normalises by.

This is the largest remaining source of domain gap, and it is why the ±12%
spatial scaling augmentation matters: it teaches the encoder not to lean on
absolute scale in the first place.

---

## Using the encoder in the browser

`npm run export` writes `model.json`, `weights.bin` and `scaler.json` (437 KB
total) to `demo-site/public/models/stroke-encoder/`.

If `npm run eval` has been run first it also ships the §6 backend —
`backend.json` (the AS-norm cohort's shape, the fitted genuine/impostor
distributions, `w`, and the SPRT boundaries) and `cohort.bin` (439 embeddings,
224 KB, §6.2's "a few hundred KB"). **Those distributions are fitted on held-out
SapiMouse identities, not on demo-site runs**, and `backend.provenance` says so
in the file so the demo can show the caveat rather than presenting them as
calibrated. The encoder works without them; the demo then produces embeddings
and reports no decision.

```ts
import * as tf from "@tensorflow/tfjs";
import {
  StrokeEncoder,
  extractFromEvents,
  cosine,
} from "../../big-boy-ts/src/shared/index.ts";

const scaler = await fetch("/models/stroke-encoder/scaler.json").then((r) => r.json());
const encoder = await StrokeEncoder.load(tf, {
  modelUrl: "/models/stroke-encoder/model.json",
  scaler,
});

// `events` are captured pointer events for one sub-task; `diagonal` is the
// demo's fixed logical canvas diagonal (§3.3 — lock the viewport).
const strokes = extractFromEvents(events, { diagonal: Math.hypot(1280, 800) });
const embedding = await encoder.encodeSubtask(strokes.map((s) => s.features));

// null when the sub-task produced fewer than two usable strokes — §6.1 skips
// those rather than scoring them noisily.
if (embedding) {
  const raw = cosine(enrollmentTemplate, embedding);
}
```

`assertScalerMatches` throws if the scaler and the build disagree on the feature
set, so a stale `scaler.json` fails loudly instead of scoring garbage.

`FEATURE_NAMES` is a wire contract between the scaler, the encoder and the
browser. **Append, never reorder**, and bump `FEATURE_VERSION` — which also
invalidates the feature cache.

---

## What is not here

- **Calibration data (§6.4).** `score.ts` implements AS-norm, the LLR and the
  SPRT boundaries, but the cohort, the fitted genuine/impostor distributions and
  the accumulation scale `w` have to come from 15–20 people running the actual
  demo flow. The harness fits them on held-out SapiMouse identities so the
  ablations mean something; those values are exported so the demo runs end to
  end, carry `provenance.source: "sapimouse-holdout"`, and are not a result.

  Measured on the live demo with those values: a genuine second run verifies
  (S = +4.0, crossing the +3.86 boundary) and a mid-flow handover lands on the
  step-up challenge (S = −0.9) rather than the −2.98 lockout. The direction is
  right and the magnitude is not, which is exactly the gap §6.4 closes — the
  browser's normalised scores swing over roughly ±15 while the fitted genuine
  distribution has σ ≈ 3.

- **A per-sub-task cohort (§6.2).** SapiMouse has no task structure, so the
  shipped cohort is one global bank keyed `"*"`. §6.2 puts most of AS-norm's
  value in the per-sub-task split, and that needs demo-flow runs.
- **Per-sub-task informativeness weights (§6.4 item 5).** Needs the demo flow.
- **The raw-trajectory CNN branch (§5.2, §7).** Explicitly a stretch goal.
- **Balabit robustness check (§5.3).** The loader is dataset-specific; pointing
  it at Balabit is a new file in `src/node/`, not a change to the pipeline.
