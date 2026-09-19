/**
 * Measures what per-user autoencoder training actually costs in tf.js, so the
 * enrolment endpoint can be sized honestly.
 *
 *   npx tsx scripts/benchAutoencoder.ts                 # native tfjs-node
 *   BIOMETRICS_TFJS_BACKEND=cpu npx tsx scripts/benchAutoencoder.ts
 */

import { join } from "node:path";
import { cpus } from "node:os";

import { loadTf } from "../src/lib/biometrics/autoencoder/backend";
import { WINDOW_FEATURE_DIM } from "../src/lib/biometrics/autoencoder/features";
import { loadUserWindows } from "../src/lib/biometrics/autoencoder/dataset";
import { trainUserModel } from "../src/lib/biometrics/autoencoder/train";
import { scoreSession } from "../src/lib/biometrics/autoencoder/score";

const ROOT = join(import.meta.dirname, "..", "..");
const TRAIN_DIR = join(ROOT, "training_files");

// Override for a quick pass, e.g. BENCH_ROWS=10000,50000 BENCH_BATCHES=1024
const ROW_BUDGETS = numList(process.env.BENCH_ROWS, [1_000, 5_000, 20_000]);
const BATCH_SIZES = numList(process.env.BENCH_BATCHES, [64, 256, 1024]);
const EPOCHS = Number(process.env.BENCH_EPOCHS ?? 120);

function numList(raw: string | undefined, fallback: number[]): number[] {
  return raw ? raw.split(",").map(Number).filter(Number.isFinite) : fallback;
}

async function main() {
  const { backend } = await loadTf();
  console.log(`backend=${backend}  node=${process.version}  cpus=${cpus().length}`);
  console.log(`model=26->64->32->12->32->64->26  epochs=${EPOCHS}\n`);

  const full = await loadUserWindows(join(TRAIN_DIR, "user7"));
  console.log(`loaded user7: ${full.rows.toLocaleString()} windows\n`);

  console.log("windows   batch   train(s)   ms/epoch   windows/s");
  console.log("-".repeat(52));

  for (const rows of ROW_BUDGETS) {
    if (rows > full.rows) continue;
    for (const batchSize of BATCH_SIZES) {
      // Fresh copy each run: trainUserModel standardises the buffer in place.
      const data = full.data.slice(0, rows * WINDOW_FEATURE_DIM);
      const t0 = performance.now();
      await trainUserModel("user7", data, rows, { epochs: EPOCHS, batchSize });
      const secs = (performance.now() - t0) / 1000;
      console.log(
        `${String(rows).padStart(7)}  ${String(batchSize).padStart(6)}  ` +
          `${secs.toFixed(2).padStart(8)}  ${((secs * 1000) / EPOCHS).toFixed(0).padStart(9)}  ` +
          `${Math.round((rows * EPOCHS) / secs).toLocaleString().padStart(9)}`,
      );
    }
  }

  // Inference cost - this is what runs on every scoring request.
  const calRows = Math.min(full.rows, 5_000);
  const profile = await trainUserModel("user7", full.data.slice(0, calRows * WINDOW_FEATURE_DIM), calRows, {
    epochs: 5,
    batchSize: 256,
  });
  for (const rows of [60, 600, 5_000]) {
    if (rows > full.rows) continue;
    const data = full.data.slice(0, rows * WINDOW_FEATURE_DIM);
    const t0 = performance.now();
    await scoreSession(profile, data, rows);
    console.log(`\nscore ${String(rows).padStart(6)} windows: ${(performance.now() - t0).toFixed(1)} ms (includes model deserialise)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
