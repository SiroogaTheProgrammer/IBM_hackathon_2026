/**
 * Training loop for the stroke encoder (description.md §5).
 *
 * A manual loop rather than `model.fit` because the margin has to ramp between
 * epochs (§5.2) and because the loss consumes an auxiliary weight matrix that
 * is never part of the saved model.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as tfTypes from "@tensorflow/tfjs";
import { FEATURE_COUNT } from "../shared/features.ts";
import { applyScaler, fitScaler } from "../shared/standardize.ts";
import type { Scaler } from "../shared/types.ts";
import { makeRng } from "../node/augment.ts";
import { featureRow, rowsForSubjects, splitSubjects, type Dataset } from "../node/dataset.ts";
import { DEFAULT_AAM, aamLogits, createHead, marginAt, type AamConfig } from "./aam.ts";
import { DEFAULT_ENCODER, buildEncoder } from "./model.ts";

export type TrainOptions = {
  epochs: number;
  /** Bags per gradient step. The encoder sees `batchSize · bagSize` strokes. */
  batchSize: number;
  /**
   * Strokes pooled into one training example (§5.1).
   *
   * The encoder is per-stroke, but the *objective* is applied to the pooled
   * embedding, exactly as the backend uses it: one embedding per sub-task,
   * average-pooled over that sub-task's strokes. Classifying single strokes
   * instead does not work on this data, and not for a tunable reason — with 96
   * identities at s = 30, the degenerate solution where every embedding and
   * every class direction collapse to one point reaches a loss of about 5.2,
   * while the best achievable per-stroke solution sits near 7.2. Collapse is
   * then the genuine optimum and the optimiser finds it. Pooling raises the
   * discriminability of one training example far enough that the real solution
   * wins. This is the same reason x-vector systems pool a whole utterance
   * before their AAM head rather than classifying individual frames.
   */
  bagSize: number;
  learningRate: number;
  /** Identities withheld from encoder training for verification eval (§5.5). */
  holdOutSubjects: number;
  embeddingDim: number;
  hidden: number[];
  dropout: number;
  weightDecay: number;
  aam: AamConfig;
  seed: number;
  outDir: string;
  log?: (line: string) => void;
};

export const DEFAULT_TRAIN: Omit<TrainOptions, "outDir"> = {
  epochs: 40,
  batchSize: 64,
  bagSize: 6,
  learningRate: 1e-3,
  holdOutSubjects: 24,
  embeddingDim: DEFAULT_ENCODER.embeddingDim,
  hidden: DEFAULT_ENCODER.hidden,
  dropout: DEFAULT_ENCODER.dropout,
  weightDecay: 1e-4,
  aam: DEFAULT_AAM,
  seed: 7,
};

export type TrainResult = {
  scaler: Scaler;
  trainSubjects: number[];
  evalSubjects: number[];
  history: { epoch: number; loss: number; accuracy: number; margin: number }[];
  modelDir: string;
};

/** Standardised feature matrix for a set of row indices, as a flat Float32Array. */
function packRows(dataset: Dataset, rows: number[], scaler: Scaler): Float32Array {
  const out = new Float32Array(rows.length * FEATURE_COUNT);
  rows.forEach((row, index) => {
    out.set(applyScaler(featureRow(dataset, row), scaler), index * FEATURE_COUNT);
  });
  return out;
}

export async function trainEncoder(
  tf: typeof tfTypes,
  dataset: Dataset,
  options: TrainOptions,
): Promise<TrainResult> {
  const log = options.log ?? (() => {});

  /* --- identity-disjoint split (§5.5) ----------------------------------- */

  const split = splitSubjects(
    dataset.meta.subjects.length,
    options.holdOutSubjects,
    options.seed,
  );
  const trainRows = rowsForSubjects(dataset, split.train);
  if (trainRows.length === 0) throw new Error("training split is empty");

  // Class ids must be contiguous for the one-hot, and the held-out identities
  // must not occupy a column in the head.
  const classOf = new Map<number, number>();
  for (const subject of Array.from(split.train).sort((a, b) => a - b)) {
    classOf.set(subject, classOf.size);
  }
  const classCount = classOf.size;

  /* --- standardisation, fitted on real training strokes only ------------ */

  // Augmented copies are excluded from the fit: they would widen every scale by
  // exactly the augmentation strength and make the shipped scaler disagree with
  // what a browser sees.
  const scalerRows = trainRows
    .filter((row) => dataset.augment[row] === 0)
    .map((row) => featureRow(dataset, row));
  const scaler = fitScaler(scalerRows);

  log(
    `train: ${trainRows.length} strokes over ${classCount} identities ` +
      `(${scalerRows.length} real, ${trainRows.length - scalerRows.length} augmented); ` +
      `held out ${split.eval.size} identities`,
  );

  /* --- tensors ---------------------------------------------------------- */

  const features = packRows(dataset, trainRows, scaler);
  const labels = Int32Array.from(trainRows, (row) => classOf.get(dataset.subject[row]!)!);

  const encoder = buildEncoder(tf, {
    inputDim: FEATURE_COUNT,
    hidden: options.hidden,
    embeddingDim: options.embeddingDim,
    dropout: options.dropout,
  });
  const head = createHead(tf, options.embeddingDim, classCount);
  const optimizer = tf.train.adam(options.learningRate);

  /* --- bags -------------------------------------------------------------- */

  // Rows are grouped by recording session so a pooled bag never mixes two
  // sittings: at test time a sub-task's strokes all come from one run, and a
  // bag that straddled sessions would train the encoder on a pooled embedding
  // that can never occur in production.
  const rowsBySession = new Map<number, number[]>();
  trainRows.forEach((row, local) => {
    const session = dataset.session[row]!;
    const bucket = rowsBySession.get(session);
    if (bucket) bucket.push(local);
    else rowsBySession.set(session, [local]);
  });

  const bagSize = Math.max(1, Math.floor(options.bagSize));
  const sessionBuckets = Array.from(rowsBySession.entries())
    .filter(([, rows]) => rows.length >= bagSize)
    .map(([session, rows]) => ({ session, rows, label: labels[rows[0]!]! }));

  if (sessionBuckets.length === 0) {
    throw new Error(`no session has ${bagSize} strokes — lower --bag`);
  }

  const rng = makeRng(options.seed);
  const shuffle = <T,>(values: T[]): void => {
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = values[i]!;
      values[i] = values[j]!;
      values[j] = tmp;
    }
  };

  /**
   * One epoch's worth of bags: every session is reshuffled and cut into
   * disjoint chunks, so each stroke is used once per epoch and a bag is always
   * a random subset of one session rather than a fixed block.
   */
  const buildEpochBags = (): { rows: number[]; label: number }[] => {
    const bags: { rows: number[]; label: number }[] = [];
    for (const bucket of sessionBuckets) {
      const shuffled = bucket.rows.slice();
      shuffle(shuffled);
      for (let start = 0; start + bagSize <= shuffled.length; start += bagSize) {
        bags.push({ rows: shuffled.slice(start, start + bagSize), label: bucket.label });
      }
    }
    shuffle(bags);
    return bags;
  };

  const history: TrainResult["history"] = [];
  const strokesPerStep = options.batchSize * bagSize;
  const batchFeatures = new Float32Array(strokesPerStep * FEATURE_COUNT);
  const batchLabels = new Int32Array(options.batchSize);

  log(
    `bags: ${bagSize} strokes pooled per example, ${options.batchSize} bags per step ` +
      `(${strokesPerStep} strokes)`,
  );

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const bags = buildEpochBags();
    const margin = marginAt(options.aam, epoch);
    let lossSum = 0;
    let correct = 0;
    let seen = 0;
    let batches = 0;

    for (let start = 0; start < bags.length; start += options.batchSize) {
      const size = Math.min(options.batchSize, bags.length - start);
      if (size < 2) break; // BatchNorm needs more than one row to have a variance

      for (let b = 0; b < size; b += 1) {
        const bag = bags[start + b]!;
        batchLabels[b] = bag.label;
        bag.rows.forEach((row, k) => {
          batchFeatures.set(
            features.subarray(row * FEATURE_COUNT, (row + 1) * FEATURE_COUNT),
            (b * bagSize + k) * FEATURE_COUNT,
          );
        });
      }

      const strokes = size * bagSize;
      const x = tf.tensor2d(batchFeatures.subarray(0, strokes * FEATURE_COUNT), [
        strokes,
        FEATURE_COUNT,
      ]);
      const y = tf.tensor1d(batchLabels.subarray(0, size), "int32");
      const oneHot = tf.oneHot(y, classCount) as tfTypes.Tensor2D;

      let batchCorrect = 0;

      const lossTensor = optimizer.minimize(() => {
        const perStroke = encoder.apply(x, { training: true }) as tfTypes.Tensor2D;

        // Average-pool within the bag, then let `aamLogits` length-normalise —
        // the same two steps `poolEmbeddings` performs at test time.
        const pooled = perStroke
          .reshape([size, bagSize, options.embeddingDim])
          .mean(1) as tfTypes.Tensor2D;

        const { logits, cosine } = aamLogits(
          tf,
          pooled,
          head,
          oneHot,
          margin,
          options.aam.scale,
        );

        // Accuracy is read from the un-penalised cosine (see `AamOutput`), and
        // in plain JS rather than with `argMax`/`equal`: those have no
        // registered gradients and have no business on the tape at all.
        const cosineValues = cosine.dataSync();
        batchCorrect = 0;
        for (let row = 0; row < size; row += 1) {
          let best = 0;
          let bestValue = -Infinity;
          for (let c = 0; c < classCount; c += 1) {
            const value = cosineValues[row * classCount + c]!;
            if (value > bestValue) {
              bestValue = value;
              best = c;
            }
          }
          if (best === batchLabels[row]!) batchCorrect += 1;
        }

        const crossEntropy = tf.losses.softmaxCrossEntropy(oneHot, logits).asScalar();

        if (options.weightDecay <= 0) return crossEntropy;

        // Explicit L2 rather than an optimizer option: tfjs's Adam has no
        // decoupled weight decay, and leaving the head undecayed lets its
        // directions drift to arbitrary magnitude before normalisation.
        let penalty = tf.scalar(0);
        for (const weight of encoder.trainableWeights) {
          if (!weight.name.includes("kernel")) continue;
          penalty = penalty.add(weight.read().square().sum());
        }

        return crossEntropy.add(penalty.mul(options.weightDecay)).asScalar();
      }, true);

      lossSum += (lossTensor?.arraySync() as number) ?? 0;
      correct += batchCorrect;
      seen += size;
      batches += 1;

      lossTensor?.dispose();
      x.dispose();
      y.dispose();
      oneHot.dispose();

      // The loop is long-running and synchronous; yielding keeps the process
      // responsive and lets tfjs-node flush its own queues.
      if (batches % 50 === 0) await tf.nextFrame();
    }

    const entry = {
      epoch,
      loss: lossSum / Math.max(1, batches),
      accuracy: correct / Math.max(1, seen),
      margin,
    };
    history.push(entry);
    log(
      `epoch ${String(epoch + 1).padStart(3)}/${options.epochs}  ` +
        `loss ${entry.loss.toFixed(4)}  acc ${(entry.accuracy * 100).toFixed(2)}%  ` +
        `m ${margin.toFixed(3)}  tensors ${tf.memory().numTensors}`,
    );
  }

  /* --- ship the encoder, discard the head (§5.2) ------------------------ */

  const modelDir = join(options.outDir, "encoder");
  mkdirSync(modelDir, { recursive: true });
  await encoder.save(`file://${modelDir}`);

  writeFileSync(
    join(options.outDir, "scaler.json"),
    `${JSON.stringify(scaler, null, 2)}\n`,
  );

  const trainSubjects = Array.from(split.train).sort((a, b) => a - b);
  const evalSubjects = Array.from(split.eval).sort((a, b) => a - b);

  writeFileSync(
    join(options.outDir, "training.json"),
    `${JSON.stringify(
      {
        options: { ...options, log: undefined },
        featureCount: FEATURE_COUNT,
        classCount,
        trainSubjects: trainSubjects.map((i) => dataset.meta.subjects[i]),
        evalSubjects: evalSubjects.map((i) => dataset.meta.subjects[i]),
        history,
        dataset: dataset.meta,
      },
      null,
      2,
    )}\n`,
  );

  head.dispose();
  encoder.dispose();

  return { scaler, trainSubjects, evalSubjects, history, modelDir };
}
