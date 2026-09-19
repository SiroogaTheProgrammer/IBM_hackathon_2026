/**
 * Offline evaluation of the `little_boy` engine, reproducing
 * ML_Models/identity_detection_full.py.
 *
 * Trains one autoencoder per user on `training_files/<user>/`, then scores
 * every user's `test_files/<user>/` data against every model and reports the
 * same rank-comparison detection rate that script prints: for each model, the
 * fraction of impostors whose mean reconstruction error lands above its own
 * owner's. 50% is chance.
 *
 *   npx tsx scripts/evalLittleBoy.ts [--epochs 50] [--batch 256] [--users 4]
 *
 * Reads the dataset from the repository root, two levels above this file.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseSessionCsv } from "../src/lib/biometrics/autoencoder/features";
import { eventsToRows, ROW_DIM } from "../src/lib/biometrics/littleboy/features";
import { rowErrors } from "../src/lib/biometrics/littleboy/score";
import { trainLittleBoy } from "../src/lib/biometrics/littleboy/train";
import type { LittleBoyProfile } from "../src/lib/biometrics/littleboy/types";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function listUsers(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/**
 * Every event in a user's directory as one row matrix.
 *
 * Each session is featurised independently: the CSVs each restart their clock
 * at 0, so carrying `lastT` across the seam would invent one huge negative
 * time_delta per file boundary.
 */
async function loadUserRows(userDir: string): Promise<{ data: Float32Array; rows: number }> {
  const names = (await readdir(userDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  const blocks: Float32Array[] = [];
  let rows = 0;
  for (const name of names) {
    const events = parseSessionCsv(await readFile(join(userDir, name), "utf8"));
    const block = eventsToRows(events);
    blocks.push(block.data);
    rows += block.rows;
  }

  const data = new Float32Array(rows * ROW_DIM);
  let offset = 0;
  for (const block of blocks) {
    data.set(block, offset);
    offset += block.length;
  }
  return { data, rows };
}

async function main() {
  const epochs = arg("epochs", 50);
  const batchSize = arg("batch", 256);
  const maxUsers = arg("users", Infinity);

  const trainRoot = join(REPO_ROOT, "training_files");
  const testRoot = join(REPO_ROOT, "test_files");
  const users = (await listUsers(trainRoot)).slice(0, maxUsers);

  console.log(`little_boy eval - ${users.length} users, ${epochs} epochs, batch ${batchSize}\n`);

  const profiles = new Map<string, LittleBoyProfile>();
  for (const user of users) {
    const t0 = Date.now();
    const { data, rows } = await loadUserRows(join(trainRoot, user));
    const profile = await trainLittleBoy(user, data, rows, { epochs, batchSize });
    profiles.set(user, profile);
    console.log(
      `trained ${user.padEnd(7)} ${String(rows).padStart(7)} events  ` +
        `genuine mean ${profile.threshold.mean.toFixed(4)}  ` +
        `cutoff ${profile.threshold.cutoff.toFixed(4)}  ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }

  // Load each user's test data once; scoring standardises in place, so every
  // model gets its own copy.
  const testRows = new Map<string, { data: Float32Array; rows: number }>();
  for (const user of users) testRows.set(user, await loadUserRows(join(testRoot, user)));

  const errors = new Map<string, Map<string, number>>();
  for (const modelUser of users) {
    const profile = profiles.get(modelUser)!;
    const row = new Map<string, number>();
    for (const dataUser of users) {
      const src = testRows.get(dataUser)!;
      const { mean } = await rowErrors(profile, Float32Array.from(src.data), src.rows);
      row.set(dataUser, mean);
    }
    errors.set(modelUser, row);
  }

  console.log("\n=== DIRECT COMPARISON DETECTION RESULTS ===");
  let totalTp = 0;
  let totalImpostors = 0;
  let ownerLowest = 0;

  for (const user of users) {
    const row = errors.get(user)!;
    const genuine = row.get(user)!;
    const impostors = users.filter((u) => u !== user).map((u) => row.get(u)!);
    const tp = impostors.filter((e) => e > genuine).length;
    totalTp += tp;
    totalImpostors += impostors.length;
    if (impostors.every((e) => e > genuine)) ownerLowest++;
    console.log(
      `${user.padEnd(7)} genuine ${genuine.toFixed(4)}  ` +
        `TP ${tp}/${impostors.length}  rate ${(tp / impostors.length).toFixed(3)}`,
    );
  }

  console.log(
    `\noverall detection rate ${totalTp}/${totalImpostors} = ` +
      `${((100 * totalTp) / totalImpostors).toFixed(1)}%  (50% = chance)`,
  );
  console.log(`owner's model is the lowest-error model for ${ownerLowest}/${users.length} users`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
