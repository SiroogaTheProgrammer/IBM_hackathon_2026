# `little_boy` — measured accuracy

Produced by `npm run eval:littleboy` (`scripts/evalLittleBoy.ts`): one model per
user trained on `training_files/<user>/`, then every user's `test_files/<user>/`
data scored against every model. The metric is the one
`ML_Models/identity_detection_full.py` prints — impostors whose mean
reconstruction error lands above the model owner's own. 50% is chance.

Run: 10 users, 50 epochs, batch 512, on an Apple-silicon laptop via `tfjs-node`.

```
trained user12   246824 events   41.5s
trained user15   149921 events   25.1s
trained user16   240046 events   41.2s
trained user20   294197 events   51.2s
trained user21   125931 events   22.6s
trained user23   124548 events   22.4s
trained user29   131751 events   23.8s
trained user35    98870 events   17.9s
trained user7    426060 events   75.7s
trained user9    415668 events   78.6s
```

| model | genuine error | impostors detected | rate |
| --- | --- | --- | --- |
| user12 | 0.0000 | 2/9 | 0.222 |
| user15 | 0.0003 | 6/9 | 0.667 |
| user16 | 0.0000 | 8/9 | 0.889 |
| user20 | 0.0001 | 5/9 | 0.556 |
| user21 | 0.0001 | 7/9 | 0.778 |
| user23 | 0.0010 | 5/9 | 0.556 |
| user29 | 0.0000 | 7/9 | 0.778 |
| user35 | 0.0022 | 2/9 | 0.222 |
| user7  | 0.0000 | 9/9 | 1.000 |
| user9  | 0.0001 | 7/9 | 0.778 |

**Overall 58/90 = 64.4%** against a 50% baseline. The owner's own model is the
lowest-error model for 1 of 10 users.

## Reading this honestly

64.4% is the number `../autoencoder/README.md` records for exactly this
representation — its first version fed one vector per raw event and "scored
64.4% on the rank metric, and the owner's own model was the lowest-error model
for only 2 of 10 users". This port lands on the same figure, which is the point:
it is a faithful reproduction of `train_pipeline_1.py`, not an attempt to beat
it. The window-feature module reaches 76.7% on the same metric.

Two caveats carry over unchanged from the sibling module:

- **The rank metric is generous.** It compares each impostor against the genuine
  user's error on the same data — a number a live check never has. The absolute
  `mean + 3σ` cutoff enrolment stores is the thing a deployed system faces, and
  it is calibrated on a held-out tail of the *same* sitting. Mouse behaviour
  drifts more between sessions than within one.
- **The ceiling is the dataset and the feature set**, not reconstruction error.
  The repo's existing siamese/metric-learning pipeline reaches AUC 0.622 / EER
  41.7% on these same users (`artifacts/report.txt`); the window autoencoder
  reaches AUC 0.573 / EER 45.2%. All three land in the same band.

"Owner's model lowest for 1/10" is the clearest statement of the limitation: the
per-event error tracks how spread out a user's coordinates and inter-event gaps
are more than it tracks who they are. Treat `error`/`z` as a relative signal
against a cohort, not as an identity gate.

## Live behaviour

`npx tsx scripts/littleBoyLive.ts` replays a real session through the live
engine one simulated tick at a time. Replaying `user12` for the 90-tick warm-up
and then scoring 40 held-out `user12` ticks against 40 `user16` ticks:

```
warm-up + inline fit   0.9s   (563 rows, ~7 events/tick at Balabit's sample rate)
genuine  (user12) n=40  mean risk 0.472
impostor (user16) n=40  mean risk 0.541
separation 0.068
```

In a browser the capture is much denser. Measured against the running dev
server with a synthetic ~50 events/tick pointer stream:

| | |
| --- | --- |
| rows captured over the 90 s warm-up | 3 978 |
| calibration block size (observed events/tick) | 52 |
| average warm-up tick | 33 ms |
| the tick that fits the model inline | **3 019 ms** |

3 s is comfortably inside the tick route's `maxDuration = 60`, but it is one
visibly slow second in the UI — the widget's `inFlight` guard skips the ticks
that overlap it rather than queueing them.
