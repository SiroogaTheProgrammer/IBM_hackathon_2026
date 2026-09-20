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
import {
  DEFAULT_QC,
  buildCohort as buildDemoCohort,
  describeSubtasks,
  embedRuns as embedDemoRuns,
  fitGaussian,
  intraclassCorrelation,
  scorePairs,
} from "./calibrate/calibrate.ts";
import { DEFAULT_OPERATING, fitOperatingPoint } from "./calibrate/operating.ts";
import type { OperatingPoint } from "./calibrate/operating.ts";
import { loadDemoRuns, loadSubjects } from "./node/demoRuns.ts";
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

  writeBackend(cohort, reports[0]!, options, calibration.length, encoder.dim);

  encoder.dispose();
}

/* ------------------------------------------------------------- backend --- */

/**
 * Write the §6 backend the browser needs: the AS-norm cohort and the fitted
 * genuine/impostor distributions.
 *
 * These are fitted on held-out *SapiMouse* identities, which is not what §6.4
 * asks for — that is 15–20 people running the actual demo flow, and until it
 * happens the cohort has no sub-task index and the distributions carry the
 * domain gap. `provenance` says so in the file itself, so the demo can show the
 * caveat rather than quietly presenting these as calibrated numbers.
 */
function writeBackend(
  cohort: Float32Array[],
  report: Report,
  options: { alpha: number; beta: number; leak: number; cohortTopN: number },
  calibrationIdentities: number,
  dim: number,
): void {
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const flat = new Float32Array(cohort.length * dim);
  cohort.forEach((embedding, index) => flat.set(embedding, index * dim));
  writeFileSync(join(ARTIFACT_DIR, "cohort.bin"), Buffer.from(flat.buffer));

  const backend = {
    featureVersion: FEATURE_VERSION,
    dim,
    cohort: {
      /*
       * SapiMouse has no task structure, so every embedding lands in the
       * global bucket. §6.2 wants one bank per sub-task id, and most of
       * AS-norm's value is in that split — see `provenance.limitations`.
       */
      file: "cohort.bin",
      count: cohort.length,
      subtaskIds: ["*"],
      topN: options.cohortTopN,
    },
    llr: {
      genuine: report.genuine,
      impostor: report.impostor,
      weight: report.weight,
    },
    thresholds: report.thresholds,
    accumulator: { leak: options.leak },
    sprt: { alpha: options.alpha, beta: options.beta },
    provenance: {
      source: "sapimouse-holdout",
      calibrationIdentities,
      eer: report.eer,
      dPrime: report.dPrime,
      limitations: [
        "Fitted on held-out SapiMouse identities, not on demo-site runs (description.md §6.4).",
        "Text-independent: SapiMouse has no sub-task ids, so the cohort is a single global bank rather than one per sub-task (§6.2).",
        "A domain gap remains between remote-logged desktop mouse data and browser pointermove capture (§8).",
      ],
    },
  };

  writeFileSync(
    join(ARTIFACT_DIR, "backend.json"),
    `${JSON.stringify(backend, null, 2)}\n`,
  );
  console.log(
    `written: ${join(ARTIFACT_DIR, "backend.json")} (${cohort.length} cohort embeddings, ${dim}-d)`,
  );
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

/* ----------------------------------------------------------- calibrate --- */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The assumed separation, recovered from the fitted pair for the record. */
function dPrimeOf(operating: OperatingPoint): string {
  return ((operating.genuine.mean - operating.impostor.mean) / operating.impostor.std).toFixed(2);
}

/** The 29 sub-tasks of the demo flow, in order — only used for report ordering. */
function flowOrder(ids: string[]): string[] {
  return ids.slice().sort((a, b) => {
    const [at = 0, as = 0] = a.split(".").map(Number);
    const [bt = 0, bs = 0] = b.split(".").map(Number);
    return at - bt || as - bs;
  });
}

async function commandCalibrate(args: Args): Promise<void> {
  const tf = await loadTf();

  const from = resolve(
    args.get("from") ?? join(ROOT, "..", "demo-site", "data", "collected"),
  );
  if (!existsSync(from)) throw new Error(`no collected runs in ${from}`);

  const subjects = loadSubjects(args.get("subjects"));
  const runs = loadDemoRuns(from, subjects);
  if (runs.length < 2) throw new Error(`need at least 2 runs, found ${runs.length}`);

  const topN = num(args, "cohort", 30);
  const qc = {
    durationMultiple: num(args, "qc-multiple", DEFAULT_QC.durationMultiple),
    minDurationSeconds: num(args, "qc-floor", DEFAULT_QC.minDurationSeconds),
  };

  const scaler = JSON.parse(
    readFileSync(join(ARTIFACT_DIR, "scaler.json"), "utf8"),
  ) as Scaler;
  const encoder = await StrokeEncoder.load(tf as never, {
    modelUrl: `file://${join(ARTIFACT_DIR, "encoder", "model.json")}`,
    scaler,
  });

  const distinct = new Set(runs.map((run) => run.subject));
  console.log(
    `${runs.length} runs, ${distinct.size} subjects, viewport ${runs[0]!.viewport.width}x${runs[0]!.viewport.height}`,
  );
  console.log(
    `QC: drop a sub-task past max(${qc.minDurationSeconds}s, ${qc.durationMultiple}x its median)\n`,
  );

  const data = await embedDemoRuns(encoder, runs, qc);
  const lost = data.dropped.filter((entry) => entry.reason === "lost").length;
  const short = data.dropped.filter(
    (entry) => entry.reason === "too-few-strokes",
  ).length;
  const attempted = data.samples.length + data.dropped.length;

  console.log(
    `embedded ${data.samples.length}/${attempted} sub-task instances` +
      `  (dropped ${lost} lost, ${short} under two strokes)`,
  );

  const cohort = buildDemoCohort(data);
  const banks = [...cohort.values()];
  console.log(
    `cohort: ${data.samples.length} embeddings across ${cohort.size} sub-task ids` +
      `  (${Math.min(...banks.map((b) => b.length))}–${Math.max(...banks.map((b) => b.length))} per id)\n`,
  );

  const { genuine, impostor } = scorePairs(data, cohort, topN);
  const impostorFit = fitGaussian(impostor.z);
  const genuineFit = genuine.z.length > 1 ? fitGaussian(genuine.z) : null;

  console.log(`impostor comparisons  ${impostor.z.length}`);
  console.log(
    `  z ~ N(${impostorFit.mean.toFixed(3)}, ${impostorFit.std.toFixed(3)})` +
      `   — AS-norm should put this near N(0, 1) by construction`,
  );
  console.log(`genuine comparisons   ${genuine.z.length}`);
  if (!genuineFit) {
    console.log(
      "  NOT FITTABLE — every participant recorded one run, so there is no\n" +
        "  same-person pair to measure. §6.4 needs one repeat run per person.",
    );
  } else {
    console.log(
      `  z ~ N(${genuineFit.mean.toFixed(3)}, ${genuineFit.std.toFixed(3)})`,
    );
  }
  console.log("");

  /*
   * With no genuine distribution there is no decision layer. `--assume-dprime`
   * borrows exactly one number — the separation — from the offline harness so
   * the demo can run; everything it implies is then solved, simulated and
   * labelled. `--assume-dprime=0` refuses the assumption and ships no decision.
   */
  const dPrime = num(args, "assume-dprime", DEFAULT_OPERATING.dPrime);
  const perRun = median(
    [...new Set(data.samples.map((sample) => sample.run))].map(
      (run) => data.samples.filter((sample) => sample.run === run).length,
    ),
  );

  const rho = intraclassCorrelation(impostor.byPair);
  console.log(
    `within-comparison correlation  rho = ${rho.toFixed(3)}` +
      `   — §6.3's "a slow user is slow everywhere", measured\n`,
  );

  let operating: OperatingPoint | null = null;
  if (!genuineFit && dPrime > 0) {
    operating = fitOperatingPoint(impostorFit, {
      ...DEFAULT_OPERATING,
      dPrime,
      correlation: rho,
      subtasksPerRun: Math.max(4, Math.round(perRun)),
    });

    console.log("operating point — ASSUMED, not measured");
    console.log(
      `  assumed d' ${dPrime.toFixed(2)} (offline harness, text-independent)` +
        `  →  genuine z ~ N(${operating.genuine.mean.toFixed(3)}, ${operating.genuine.std.toFixed(3)})`,
    );
    console.log(
      `  w ${operating.weight.toFixed(2)} solved for false lockout <= ${DEFAULT_OPERATING.alpha}` +
        `  over ${Math.max(4, Math.round(perRun))} sub-tasks/run`,
    );
    console.log(
      `  simulated: lockout of impostors ${(operating.simulated.impostorDetectionRate * 100).toFixed(1)}%` +
        `, false lockout ${(operating.simulated.falseLockoutRate * 100).toFixed(1)}%` +
        `, median ${operating.simulated.medianSubtasksToDetection ?? "—"} sub-tasks\n`,
    );
  }

  const reports = describeSubtasks(data, flowOrder(data.subtaskIds));
  console.log("per sub-task (§6.4 item 5 — the flow design loop)");
  console.log("  id    kept  lost  short   med_s  strokes   between-subject cos");
  for (const report of reports) {
    const similarity = Number.isFinite(report.betweenSubjectSimilarity)
      ? report.betweenSubjectSimilarity.toFixed(3)
      : "  —  ";
    const spread = Number.isFinite(report.betweenSubjectSpread)
      ? `±${report.betweenSubjectSpread.toFixed(3)}`
      : "";
    console.log(
      `  ${report.subtaskId.padEnd(5)} ${String(report.kept).padStart(4)}` +
        ` ${String(report.droppedLost).padStart(5)} ${String(report.droppedShort).padStart(6)}` +
        ` ${report.medianSeconds.toFixed(1).padStart(7)} ${report.medianStrokes.toFixed(0).padStart(8)}` +
        `   ${similarity} ${spread}`,
    );
  }

  writeDemoBackend({
    data,
    cohort,
    impostorFit,
    genuineFit,
    topN,
    qc,
    runs: runs.length,
    subjects: distinct.size,
    reports,
    operating,
  });

  encoder.dispose();
}

type DemoBackendInput = {
  data: Awaited<ReturnType<typeof embedDemoRuns>>;
  cohort: Map<string, Float32Array[]>;
  impostorFit: { mean: number; std: number };
  genuineFit: { mean: number; std: number } | null;
  topN: number;
  qc: { durationMultiple: number; minDurationSeconds: number };
  runs: number;
  subjects: number;
  reports: ReturnType<typeof describeSubtasks>;
  operating: OperatingPoint | null;
};

/**
 * Write the demo-calibrated backend.
 *
 * The cohort and the impostor distribution come from real demo runs. The
 * genuine distribution does not exist yet, so rather than borrowing SapiMouse's
 * — which was fitted under a *different cohort* and therefore on a different
 * z-scale — the file records that it is missing and the demo reports no
 * decision. A verdict from half a calibration is worse than no verdict.
 */
function writeDemoBackend(input: DemoBackendInput): void {
  const { data, cohort, impostorFit, genuineFit } = input;

  const dim = data.samples[0]?.embedding.length ?? 128;
  const subtaskIds = flowOrder([...cohort.keys()]);

  const flat: number[] = [];
  const offsets: Record<string, { start: number; count: number }> = {};
  let cursor = 0;
  for (const subtaskId of subtaskIds) {
    const bank = cohort.get(subtaskId) ?? [];
    offsets[subtaskId] = { start: cursor, count: bank.length };
    for (const embedding of bank) {
      for (const value of embedding) flat.push(value);
    }
    cursor += bank.length;
  }

  /*
   * A global bank as well, costing nothing: the flat buffer already holds every
   * embedding in order, so "*" is just the whole range. AS-norm needs four
   * entries to engage, and the thinner sub-task banks do not have four once
   * both sides of a comparison are held out — those fall back to the global
   * bank, which is still better than the unnormalised cosine.
   */
  offsets["*"] = { start: 0, count: cursor };

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    join(ARTIFACT_DIR, "cohort.bin"),
    Buffer.from(new Float32Array(flat).buffer),
  );

  const backend = {
    featureVersion: FEATURE_VERSION,
    dim,
    cohort: {
      file: "cohort.bin",
      count: cursor,
      /** Per sub-task id — §6.2 as specified, which SapiMouse could not give. */
      index: offsets,
      subtaskIds,
      topN: input.topN,
    },
    llr: genuineFit
      ? { genuine: genuineFit, impostor: impostorFit, weight: 1 }
      : input.operating
        ? {
            genuine: input.operating.genuine,
            impostor: input.operating.impostor,
            weight: input.operating.weight,
          }
        : null,
    /**
     * True when the genuine half of the LLR was assumed rather than measured.
     * The demo reads this and says so on screen — see `operating.ts`.
     */
    assumedGenuine: !genuineFit && input.operating !== null,
    thresholds: genuineFit
      ? null
      : (input.operating?.thresholds ?? null),
    simulated: input.operating?.simulated ?? null,
    accumulator: { leak: 0.97 },
    sprt: { alpha: 0.02, beta: 0.05 },
    provenance: {
      source: "demo-site-calibration",
      runs: input.runs,
      subjects: input.subjects,
      embeddedSubtasks: data.samples.length,
      droppedLost: data.dropped.filter((entry) => entry.reason === "lost").length,
      droppedShort: data.dropped.filter(
        (entry) => entry.reason === "too-few-strokes",
      ).length,
      qc: input.qc,
      limitations: genuineFit
        ? []
        : [
            "The genuine score distribution is ASSUMED, not measured: no participant recorded the flow twice, so no same-person pair exists (§6.4 item 1).",
            `Exactly one number is borrowed — d' = ${input.operating?.genuine ? dPrimeOf(input.operating) : "n/a"} from the offline SapiMouse harness. It was measured without sub-task alignment, which §2 calls the largest accuracy lever, so it should understate the real separation and the system errs toward missing impostors rather than locking out genuine users.`,
            "w and the error rates are solved by simulation against that assumption (§6.3), not measured on real runs.",
            "No per-sub-task d' weights (§6.4 item 5). betweenSubjectSimilarity is reported instead.",
            "No familiarisation pass was discarded and participants' prior knowledge of the real MyCourses app varies, so think-time differences carry familiarity as well as identity (§2.3).",
          ],
    },
    subtasks: input.reports,
  };

  writeFileSync(
    join(ARTIFACT_DIR, "backend.json"),
    `${JSON.stringify(backend, null, 2)}\n`,
  );
  console.log(`\nwritten: ${join(ARTIFACT_DIR, "backend.json")}`);
  console.log(`written: ${join(ARTIFACT_DIR, "cohort.bin")} (${cursor} x ${dim})`);
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

  // The §6 backend is optional: the encoder alone still produces embeddings,
  // and the demo degrades to "no decision" without a fitted LLR model.
  const backend = join(ARTIFACT_DIR, "backend.json");
  if (existsSync(backend)) {
    cpSync(backend, join(target, "backend.json"));
    cpSync(join(ARTIFACT_DIR, "cohort.bin"), join(target, "cohort.bin"));
    console.log("exported AS-norm cohort + fitted LLR model");
  } else {
    console.log("no backend.json — run:  node src/cli.ts eval");
  }

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

  calibrate [--from=<dir>] [--subjects=<map.json>] [--cohort=30]
            [--qc-multiple=4] [--qc-floor=12]
      Fit §6.4 from runs recorded on the demo site: per-sub-task AS-norm
      cohort, impostor distribution, and the flow's design-loop report.
      Overwrites artifacts/backend.json.

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
    case "calibrate":
      await commandCalibrate(args);
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
