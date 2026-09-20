#!/usr/bin/env node
/**
 * big-boy-ts — stroke encoder for continuous impostor detection.
 *
 *   node src/cli.ts extract   build the stroke feature cache from data/sapimouse
 *   node src/cli.ts train     train the encoder with AAM-softmax
 *   node src/cli.ts eval      replay held-out identities through the §6 backend
 *   node src/cli.ts export    copy encoder + scaler into the demo site
 *
 * `--help` on any subcommand lists its flags.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as tfTypes from "@tensorflow/tfjs";
import { FEATURE_COUNT, FEATURE_NAMES, FEATURE_VERSION } from "./shared/features.ts";
import { StrokeEncoder } from "./shared/embed.ts";
import type { Scaler } from "./shared/types.ts";
import {
  buildDataset,
  readDataset,
  splitSubjects,
  type Dataset,
} from "./node/dataset.ts";
import { DEFAULT_TRAIN, trainEncoder } from "./train/train.ts";
import { DEFAULT_AAM } from "./train/aam.ts";
import {
  DEFAULT_EVAL,
  buildCohort,
  embedRuns,
  evaluate,
  pairRuns,
  type Report,
} from "./eval/verify.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data", "sapimouse");
const CACHE_DIR = join(ROOT, "cache");
const ARTIFACT_DIR = join(ROOT, "artifacts");

/* ---------------------------------------------------------------- args --- */

type Args = Map<string, string>;

function parseArgs(argv: string[]): Args {
  const args: Args = new Map();
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.slice(2).split("=");
    args.set(key!, value ?? "true");
  }
  return args;
}

const num = (args: Args, key: string, fallback: number): number => {
  const raw = args.get(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number, got "${raw}"`);
  return value;
};

const flag = (args: Args, key: string): boolean => args.get(key) === "true";

/**
 * tfjs-node re-exports the whole tfjs API backed by the native CPU kernels, and
 * additionally registers the `file://` IO handler that `model.save()` needs.
 * It is loaded dynamically so the shared code stays importable in a browser.
 */
async function loadTf(): Promise<typeof tfTypes> {
  const loaded = (await import("@tensorflow/tfjs-node")) as unknown as Record<string, unknown>;
  return (loaded["default"] ?? loaded) as typeof tfTypes;
}

function requireDataset(): Dataset {
  const dataset = readDataset(CACHE_DIR);
  if (!dataset) {
    throw new Error(
      `no feature cache for "${FEATURE_VERSION}" in ${CACHE_DIR}\n` +
        `run:  node src/cli.ts extract`,
    );
  }
  return dataset;
}

/* ------------------------------------------------------------- extract --- */

function commandExtract(args: Args): void {
  if (!existsSync(DATA_DIR)) {
    throw new Error(
      `${DATA_DIR} not found.\n` +
        `The dataset is gitignored — see README.md for the expected layout.`,
    );
  }

  const augmentCopies = num(args, "augment", 2);
  const started = Date.now();

  console.log(`extracting ${FEATURE_COUNT} features (${FEATURE_VERSION}) from ${DATA_DIR}`);
  console.log(`augmented copies per stroke: ${augmentCopies}`);

  const dataset = buildDataset({
    root: DATA_DIR,
    cacheDir: CACHE_DIR,
    augmentCopies,
    seed: num(args, "seed", 7),
    onProgress: (done, total, note) => {
      if (done % 20 === 0 || done === total) {
        console.log(`  [${String(done).padStart(3)}/${total}] ${note}`);
      }
    },
  });

  const real = dataset.augment.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  console.log(
    `\n${dataset.meta.rows} rows (${real} real, ${dataset.meta.rows - real} augmented) ` +
      `from ${dataset.meta.sessions.length} sessions, ${dataset.meta.subjects.length} subjects ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(`cache: ${CACHE_DIR}`);
  summariseFeatures(dataset);
}

/** Per-feature spread, printed once so a degenerate feature is obvious early. */
function summariseFeatures(dataset: Dataset): void {
  const width = dataset.meta.featureCount;
  const sums = new Float64Array(width);
  const squares = new Float64Array(width);
  let real = 0;

  for (let row = 0; row < dataset.meta.rows; row += 1) {
    if (dataset.augment[row] !== 0) continue;
    real += 1;
    for (let i = 0; i < width; i += 1) {
      const value = dataset.features[row * width + i]!;
      sums[i]! += value;
      squares[i]! += value * value;
    }
  }

  console.log("\nfeature  mean / std (real strokes only)");
  for (let i = 0; i < width; i += 1) {
    const mean = sums[i]! / Math.max(1, real);
    const std = Math.sqrt(Math.max(0, squares[i]! / Math.max(1, real) - mean * mean));
    const warning = std < 1e-6 ? "   <- constant, carries no information" : "";
    console.log(
      `  ${FEATURE_NAMES[i]!.padEnd(30)} ${mean.toFixed(4).padStart(12)} ${std
        .toFixed(4)
        .padStart(12)}${warning}`,
    );
  }
}

/* --------------------------------------------------------------- train --- */

async function commandTrain(args: Args): Promise<void> {
  const tf = await loadTf();
  const dataset = requireDataset();

  console.log(`backend: ${tf.getBackend()}`);
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const result = await trainEncoder(tf, dataset, {
    ...DEFAULT_TRAIN,
    epochs: num(args, "epochs", DEFAULT_TRAIN.epochs),
    batchSize: num(args, "batch", DEFAULT_TRAIN.batchSize),
    bagSize: num(args, "bag", DEFAULT_TRAIN.bagSize),
    learningRate: num(args, "lr", DEFAULT_TRAIN.learningRate),
    holdOutSubjects: num(args, "holdout", DEFAULT_TRAIN.holdOutSubjects),
    embeddingDim: num(args, "dim", DEFAULT_TRAIN.embeddingDim),
    dropout: num(args, "dropout", DEFAULT_TRAIN.dropout),
    weightDecay: num(args, "wd", DEFAULT_TRAIN.weightDecay),
    seed: num(args, "seed", DEFAULT_TRAIN.seed),
    aam: {
      ...DEFAULT_AAM,
      margin: num(args, "margin", DEFAULT_AAM.margin),
      scale: num(args, "scale", DEFAULT_AAM.scale),
      warmupEpochs: num(args, "warmup", DEFAULT_AAM.warmupEpochs),
    },
    outDir: ARTIFACT_DIR,
    log: (line) => console.log(line),
  });

  console.log(`\nencoder: ${result.modelDir}`);
  console.log(`scaler:  ${join(ARTIFACT_DIR, "scaler.json")}`);
  console.log(`run:     node src/cli.ts eval`);
}

/* ---------------------------------------------------------------- eval --- */

async function commandEval(args: Args): Promise<void> {
  const tf = await loadTf();
  const dataset = requireDataset();

  const scalerPath = join(ARTIFACT_DIR, "scaler.json");
  if (!existsSync(scalerPath)) {
    throw new Error(`no trained encoder in ${ARTIFACT_DIR} — run:  node src/cli.ts train`);
  }
  const scaler = JSON.parse(readFileSync(scalerPath, "utf8")) as Scaler;
  const training = JSON.parse(
    readFileSync(join(ARTIFACT_DIR, "training.json"), "utf8"),
  ) as { options: { holdOutSubjects: number; seed: number } };

  const encoder = await StrokeEncoder.load(tf as never, {
    modelUrl: `file://${join(ARTIFACT_DIR, "encoder", "model.json")}`,
    scaler,
  });
  console.log(`encoder loaded: ${FEATURE_COUNT}-d in, ${encoder.dim}-d embedding`);

  // Exactly the split training used, so the evaluation identities were never
  // seen by the encoder (§5.5).
  const split = splitSubjects(
    dataset.meta.subjects.length,
    training.options.holdOutSubjects,
    training.options.seed,
  );
  const held = Array.from(split.eval).sort((a, b) => a - b);
  if (held.length < 4) throw new Error("need at least 4 held-out identities to evaluate");

  const options = {
    ...DEFAULT_EVAL,
    alpha: num(args, "alpha", DEFAULT_EVAL.alpha),
    beta: num(args, "beta", DEFAULT_EVAL.beta),
    leak: num(args, "leak", DEFAULT_EVAL.leak),
    cohortTopN: num(args, "cohort", DEFAULT_EVAL.cohortTopN),
  };

  console.log(`embedding ${held.length} held-out identities...`);
  const runs = await embedRuns(encoder, dataset, new Set(held));
  const pairs = pairRuns(runs);
  if (pairs.length < 4) {
    throw new Error(
      `only ${pairs.length} held-out identities have two usable runs; increase --holdout and retrain`,
    );
  }

  // The backend is fitted on one half of the held-out identities and measured
  // on the other (§5.5, §6.4): calibration users are held out from scoring too.
  const cut = Math.max(2, Math.round(pairs.length * options.calibrationFraction));
  const calibration = pairs.slice(0, cut);
  const evaluation = pairs.slice(cut);
  if (evaluation.length < 2) throw new Error("evaluation split is too small");

  console.log(
    `${calibration.length} calibration identities, ${evaluation.length} evaluation identities`,
  );

  const cohort = buildCohort(calibration);
  console.log(`AS-norm cohort: ${cohort.length} embeddings\n`);

  // §7's ablation list, minus the ones that need the demo flow: "without
  // sub-task alignment" is already the setting here, and "without timing
  // features" needs a second encoder trained on an ablated feature set.
  const reports: Report[] = [
    evaluate("full (AS-norm + accumulation)", calibration, evaluation, cohort, options, true, true),
    evaluate("without AS-norm", calibration, evaluation, cohort, options, false, true),
    evaluate("without accumulation (leak=0)", calibration, evaluation, cohort, options, true, false),
  ];

  for (const report of reports) printReport(report);

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    join(ARTIFACT_DIR, "evaluation.json"),
    `${JSON.stringify({ options, identities: { calibration: calibration.length, evaluation: evaluation.length }, reports }, null, 2)}\n`,
  );
  console.log(`\nwritten: ${join(ARTIFACT_DIR, "evaluation.json")}`);

  encoder.dispose();
}

function printReport(report: Report): void {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  console.log(`── ${report.variant} ${"─".repeat(Math.max(0, 52 - report.variant.length))}`);
  console.log(`  comparisons               ${report.comparisons}`);
  console.log(`  EER                       ${pct(report.eer)}`);
  console.log(
    `  genuine / impostor        ${report.genuine.mean.toFixed(3)}±${report.genuine.std.toFixed(3)}` +
      `  vs  ${report.impostor.mean.toFixed(3)}±${report.impostor.std.toFixed(3)}   d' ${report.dPrime.toFixed(2)}`,
  );
  console.log(
    `  SPRT thresholds           +${report.thresholds.upper.toFixed(2)} / ${report.thresholds.lower.toFixed(2)} nats, w=${report.weight.toFixed(2)}`,
  );
  console.log(`  impostor detection rate   ${pct(report.impostorDetectionRate)}`);
  console.log(`  false lockout rate        ${pct(report.falseLockoutRate)}   (target ≤ 5%)`);
  console.log(
    `  blocks to detection       median ${report.blocksToDetection.median ?? "—"}, p90 ${report.blocksToDetection.p90 ?? "—"}`,
  );
  console.log("");
}

/* -------------------------------------------------------------- export --- */

function commandExport(args: Args): void {
  const target = resolve(
    args.get("to") ?? join(ROOT, "..", "demo-site", "public", "models", "stroke-encoder"),
  );
  const source = join(ARTIFACT_DIR, "encoder");
  if (!existsSync(source)) {
    throw new Error(`no trained encoder in ${source} — run:  node src/cli.ts train`);
  }

  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  cpSync(join(ARTIFACT_DIR, "scaler.json"), join(target, "scaler.json"));

  console.log(`exported encoder + scaler to ${target}`);
  console.log(`feature set: ${FEATURE_VERSION} (${FEATURE_COUNT} features)`);
}

/* ---------------------------------------------------------------- main --- */

const USAGE = `big-boy-ts — stroke encoder for continuous impostor detection

  extract [--augment=2] [--seed=7]
      Segment every SapiMouse session into strokes, extract features,
      cache the matrix under cache/.

  train [--epochs=40] [--batch=64] [--bag=6] [--lr=0.001] [--holdout=24]
        [--dim=128] [--dropout=0.2] [--wd=0.0001]
        [--margin=0.2] [--scale=30] [--warmup=5] [--seed=7]
      Train the encoder with AAM-softmax over the training identities.

  eval [--alpha=0.02] [--beta=0.05] [--leak=0.97] [--cohort=30]
      Replay held-out identities through the AS-norm + SPRT backend.

  export [--to=<dir>]
      Copy encoder + scaler into the demo site's public/ directory.
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "extract":
      commandExtract(args);
      break;
    case "train":
      await commandTrain(args);
      break;
    case "eval":
      await commandEval(args);
      break;
    case "export":
      commandExport(args);
      break;
    default:
      console.log(USAGE);
      if (command && command !== "--help" && command !== "help") process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`\nerror: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
