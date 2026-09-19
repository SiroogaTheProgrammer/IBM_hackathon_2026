/**
 * Reproduces ML_Models/identity_detection_full.py in tf.js: train one
 * autoencoder per user on training_files/, then score every user's test_files/
 * data against every model and report genuine-vs-impostor separation.
 *
 *   npx tsx scripts/evalAutoencoder.ts [maxRowsPerUser]
 */

import { join } from "node:path";

import { loadTf } from "../src/lib/biometrics/autoencoder/backend";
import { listUsers, loadUserWindows } from "../src/lib/biometrics/autoencoder/dataset";
import { WINDOW_FEATURE_DIM } from "../src/lib/biometrics/autoencoder/features";
import { scoreSession, windowErrors } from "../src/lib/biometrics/autoencoder/score";
import { trainUserModel } from "../src/lib/biometrics/autoencoder/train";
import type { UserProfile } from "../src/lib/biometrics/autoencoder/types";

const ROOT = join(import.meta.dirname, "..", "..");
const MAX_ROWS: number = Number(process.argv[2] ?? Infinity);
const EPOCHS = Number(process.env.EVAL_EPOCHS ?? 120);

async function main() {
  const { backend } = await loadTf();
  console.log(`backend=${backend}  maxWindows/user=${MAX_ROWS}  epochs=${EPOCHS}\n`);

  const users = await listUsers(join(ROOT, "training_files"));

  const profiles = new Map<string, UserProfile>();
  for (const user of users) {
    const full = await loadUserWindows(join(ROOT, "training_files", user));
    const rows = Math.min(full.rows, MAX_ROWS);
    const data = full.data.slice(0, rows * WINDOW_FEATURE_DIM);

    const t0 = performance.now();
    profiles.set(user, await trainUserModel(user, data, rows, { epochs: EPOCHS, batchSize: 256 }));
    console.log(`trained ${user}: ${rows.toLocaleString()} windows in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  }

  // Test data, loaded once and reused across every model.
  const testData = new Map<string, { data: Float32Array; rows: number }>();
  for (const user of users) {
    const full = await loadUserWindows(join(ROOT, "test_files", user));
    const rows = Math.min(full.rows, MAX_ROWS);
    testData.set(user, { data: full.data.slice(0, rows * WINDOW_FEATURE_DIM), rows });
  }

  console.log("\n=== mean reconstruction error (rows = model owner, cols = data owner) ===");
  console.log(["model".padEnd(8), ...users.map((u) => u.padStart(9))].join(""));

  let correct = 0;
  let total = 0;
  const perUser: { user: string; genuine: number; caught: number; of: number }[] = [];
  const matrix: number[][] = [];
  for (const modelUser of users) {
    const profile = profiles.get(modelUser)!;
    const errs: number[] = [];
    for (const dataUser of users) {
      const td = testData.get(dataUser)!;
      // scoreSession standardises in place, so hand it a copy.
      const r = await scoreSession(profile, td.data.slice(), td.rows);
      errs.push(r.error);
    }
    console.log([modelUser.padEnd(8), ...errs.map((e) => e.toFixed(4).padStart(9))].join(""));

    matrix.push(errs);
    const genuine = errs[users.indexOf(modelUser)];
    let caught = 0;
    for (let i = 0; i < users.length; i++) {
      if (users[i] === modelUser) continue;
      total++;
      if (errs[i] > genuine) correct++, caught++;
    }
    perUser.push({ user: modelUser, genuine, caught, of: users.length - 1 });
  }

  console.log("\n=== per-model impostor detection ===");
  for (const r of perUser) {
    console.log(`${r.user.padEnd(9)} genuine=${r.genuine.toFixed(4)}  caught ${r.caught}/${r.of}`);
  }

  // Identification view: for each user's data, does their OWN model give the
  // lowest error? If the diagonal is not the column minimum, the error is
  // tracking something other than identity.
  console.log("\n=== rank of each user's own model on their own data (1 = best) ===");
  for (let j = 0; j < users.length; j++) {
    const order = users.map((_, i) => i).sort((a, b) => matrix[a][j] - matrix[b][j]);
    console.log(`${users[j].padEnd(9)} rank ${order.indexOf(j) + 1}/${users.length}`);
  }

  await reportEer(users, profiles, testData);

  console.log(`\nimpostors scoring above their genuine user: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)`);
  console.log("note: this is the same rank-comparison metric as identity_detection_full.py.");
  console.log("It needs the genuine error as a reference, so it measures separability, not");
  console.log("live detection accuracy - a deployed check only has the threshold to go on.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** Mean of every non-overlapping run of `k` consecutive windows. */
function aggregate(scores: Float32Array, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + k <= scores.length; i += k) {
    let sum = 0;
    for (let j = i; j < i + k; j++) sum += scores[j];
    out.push(sum / k);
  }
  return out;
}

/**
 * Equal error rate: sweep the decision threshold over all observed scores and
 * find where the false-accept and false-reject rates cross. Unlike the
 * rank-comparison metric this needs no reference to the genuine error, so it
 * reflects what a deployed per-user threshold can actually achieve.
 */
function eer(genuine: number[], impostor: number[]): number {
  if (!genuine.length || !impostor.length) return 0.5;

  // Two-pointer sweep over both sorted score lists. Recomputing far/frr by
  // filtering at every candidate threshold is quadratic, which on ~100k
  // pooled window scores is minutes per user rather than milliseconds.
  const g = [...genuine].sort((a, b) => a - b);
  const im = [...impostor].sort((a, b) => a - b);

  let gi = 0; // genuine scores <= t
  let ii = 0; // impostor scores <= t
  let best = 1;

  for (const t of [...g, ...im].sort((a, b) => a - b)) {
    while (gi < g.length && g[gi] <= t) gi++;
    while (ii < im.length && im[ii] <= t) ii++;
    // Higher error => impostor.
    const far = ii / im.length;
    const frr = (g.length - gi) / g.length;
    best = Math.min(best, Math.max(far, frr));
  }
  return best;
}

/**
 * AUC via the Mann-Whitney U statistic, so it is directly comparable with the
 * `roc_auc` column in artifacts/report.txt from the existing siamese pipeline.
 * Higher error => impostor, so we score impostors as the positive class.
 */
function auc(genuine: number[], impostor: number[]): number {
  if (!genuine.length || !impostor.length) return 0.5;
  const all = [...genuine.map((v) => ({ v, imp: 0 })), ...impostor.map((v) => ({ v, imp: 1 }))].sort(
    (a, b) => a.v - b.v,
  );

  // Average ranks over ties, otherwise tied scores inflate or deflate the AUC.
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j].v === all[i].v) j++;
    const avgRank = (i + j + 1) / 2; // 1-based average of ranks i+1..j
    for (let k = i; k < j; k++) if (all[k].imp) rankSum += avgRank;
    i = j;
  }

  const n1 = impostor.length;
  const n0 = genuine.length;
  return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

async function reportEer(
  users: string[],
  profiles: Map<string, UserProfile>,
  testData: Map<string, { data: Float32Array; rows: number }>,
) {
  // Per-window error of every user's test data under every user's model.
  const errs = new Map<string, Map<string, Float32Array>>();
  for (const modelUser of users) {
    const inner = new Map<string, Float32Array>();
    for (const dataUser of users) {
      const td = testData.get(dataUser)!;
      const { perWindow } = await windowErrors(profiles.get(modelUser)!, td.data.slice(), td.rows);
      inner.set(dataUser, perWindow);
    }
    errs.set(modelUser, inner);
  }

  // 1 window ~= 1 s of active mousing, matching BiometricsWidget's tick.
  const LENGTHS = [1, 10, 30, 60];
  console.log("\n=== equal error rate by observation length (lower is better, 50% = chance) ===");
  console.log("user      " + LENGTHS.map((k) => `${k}w`.padStart(8)).join("") + "   AUC@1w");
  const meanEer = new Map<number, number[]>(LENGTHS.map((k) => [k, []]));
  const aucs: number[] = [];

  for (const modelUser of users) {
    const row: string[] = [];
    for (const k of LENGTHS) {
      const genuine = aggregate(errs.get(modelUser)!.get(modelUser)!, k);
      const impostor = users
        .filter((u) => u !== modelUser)
        .flatMap((u) => aggregate(errs.get(modelUser)!.get(u)!, k));
      const e = eer(genuine, impostor);
      meanEer.get(k)!.push(e);
      row.push(`${(e * 100).toFixed(1)}%`.padStart(8));
      if (k === 1) aucs.push(auc(genuine, impostor));
    }
    console.log(modelUser.padEnd(10) + row.join("") + `${aucs[aucs.length - 1].toFixed(3)}`.padStart(9));
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    "mean".padEnd(10) +
      LENGTHS.map((k) => `${(avg(meanEer.get(k)!) * 100).toFixed(1)}%`.padStart(8)).join("") +
      `${avg(aucs).toFixed(3)}`.padStart(9),
  );
  console.log("1w ~= 1 s of active mousing. Compare AUC/EER with the roc_auc and eer");
  console.log("columns in artifacts/report.txt from the existing siamese pipeline.");
}
