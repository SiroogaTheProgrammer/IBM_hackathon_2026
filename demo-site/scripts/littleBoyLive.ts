/**
 * End-to-end check of the `little_boy` live engine, without a browser.
 *
 * Replays a real session from `training_files/` through `runLittleBoyModule`
 * one simulated tick at a time - the same call `/api/biometrics/tick` makes -
 * so the warm-up counter, the inline fit and the Redis round-trip all run
 * exactly as they do in the app. Then it scores held-out ticks from the same
 * user (genuine) and from a different user (impostor) and prints the risk the
 * widget would display for each.
 *
 *   npx tsx scripts/littleBoyLive.ts [--user user12] [--impostor user16]
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseSessionCsv } from "../src/lib/biometrics/autoencoder/features";
import {
  LITTLEBOY_WARMUP_SIZE,
  resetLittleBoy,
  runLittleBoyModule,
} from "../src/lib/biometrics/littleboy/liveEngine";
import type { MouseEvent2D } from "../src/lib/biometrics/types";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** One user's first session, as events. */
async function loadSession(user: string): Promise<MouseEvent2D[]> {
  const dir = join(REPO_ROOT, "training_files", user);
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  return parseSessionCsv(await readFile(join(dir, names[0]), "utf8"));
}

/** Slice a session into one-second batches, the shape the widget posts. */
function toTicks(events: MouseEvent2D[]): MouseEvent2D[][] {
  const ticks: MouseEvent2D[][] = [];
  let current: MouseEvent2D[] = [];
  let boundary = (events[0]?.t ?? 0) + 1;
  for (const e of events) {
    while (e.t >= boundary) {
      ticks.push(current);
      current = [];
      boundary += 1;
    }
    current.push(e);
  }
  if (current.length) ticks.push(current);
  return ticks.filter((t) => t.length >= 3);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main() {
  const user = arg("user", "user12");
  const impostor = arg("impostor", "user16");
  const sid = `littleboy-live-${Date.now()}`;

  const genuineTicks = toTicks(await loadSession(user));
  const impostorTicks = toTicks(await loadSession(impostor));
  console.log(
    `${user}: ${genuineTicks.length} ticks available, ${impostor}: ${impostorTicks.length}\n`,
  );

  await resetLittleBoy(sid);

  // --- warm-up -------------------------------------------------------------
  const t0 = Date.now();
  let fitResult;
  for (let i = 0; i < LITTLEBOY_WARMUP_SIZE; i++) {
    fitResult = await runLittleBoyModule(sid, genuineTicks[i]);
    if (i % 30 === 0 || i === LITTLEBOY_WARMUP_SIZE - 1) {
      console.log(`tick ${String(i + 1).padStart(3)}  ${fitResult.status}  ${JSON.stringify(fitResult.detail)}`);
    }
  }
  if (fitResult?.status === "error") {
    throw new Error(`fit failed: ${JSON.stringify(fitResult.detail)}`);
  }
  console.log(`\nwarm-up + inline fit took ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  // --- score ---------------------------------------------------------------
  // Held-out genuine ticks come after the warm-up slice, so they are not rows
  // the model trained on.
  const held = genuineTicks.slice(LITTLEBOY_WARMUP_SIZE, LITTLEBOY_WARMUP_SIZE + 40);
  const genuineRisks: number[] = [];
  for (const tick of held) {
    const r = await runLittleBoyModule(sid, tick);
    if (r.status === "active") genuineRisks.push(r.risk_score);
  }

  const impostorRisks: number[] = [];
  for (const tick of impostorTicks.slice(0, 40)) {
    const r = await runLittleBoyModule(sid, tick);
    if (r.status === "active") impostorRisks.push(r.risk_score);
  }

  console.log(`genuine  (${user}) n=${genuineRisks.length}  mean risk ${mean(genuineRisks).toFixed(3)}`);
  console.log(`impostor (${impostor}) n=${impostorRisks.length}  mean risk ${mean(impostorRisks).toFixed(3)}`);
  console.log(
    `\nseparation: ${(mean(impostorRisks) - mean(genuineRisks)).toFixed(3)} ` +
      `(positive = impostor scored higher, which is the intended direction)`,
  );

  await resetLittleBoy(sid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
