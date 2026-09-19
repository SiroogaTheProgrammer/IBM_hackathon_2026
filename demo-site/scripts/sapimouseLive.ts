/**
 * Simulate the live loop: replay real SapiMouse recordings through
 * `runSapimouseModule` in ~1 s tick batches, exactly as BiometricsWidget posts
 * them, and check the engine does what the dropdown promises -
 *
 *   warm up on the user   -> gallery fills, no score yet
 *   same user continues   -> low risk
 *   a different user      -> high risk
 *
 *   npx tsx scripts/sapimouseLive.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runSapimouseModule, resetSapimouse, SAPIMOUSE_WARMUP_SIZE } from "../src/lib/biometrics/sapimouse/liveEngine";
import type { MouseEvent2D } from "../src/lib/biometrics/types";

const ROOT = "../encoder2/data/sapimouse";
const TICK_S = 1.0;

function loadCsv(path: string): MouseEvent2D[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const head = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const [ti, bi, si, xi, yi] =
    ["client timestamp", "button", "state", "x", "y"].map((c) => head.indexOf(c));
  return lines.slice(1).map((l) => {
    const p = l.split(",");
    // CSV is milliseconds; the widget sends performance.now()/1000, i.e. seconds
    return { t: Number(p[ti]) * 1e-3, x: Number(p[xi]), y: Number(p[yi]),
             button: p[bi], state: p[si] };
  });
}

function ticks(events: MouseEvent2D[]): MouseEvent2D[][] {
  const out: MouseEvent2D[][] = [];
  if (!events.length) return out;
  let start = events[0].t, cur: MouseEvent2D[] = [];
  for (const e of events) {
    if (e.t - start >= TICK_S) { out.push(cur); cur = []; start = e.t; }
    cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

function sessionFiles(user: string) {
  const fs = readdirSync(join(ROOT, user)).filter((f) => f.endsWith(".csv")).sort();
  return {
    long: join(ROOT, user, fs.find((f) => f.includes("3min")) ?? fs[0]),
    short: join(ROOT, user, fs.find((f) => f.includes("1min")) ?? fs[fs.length - 1]),
  };
}

async function replay(sid: string, events: MouseEvent2D[], label: string) {
  const batches = ticks(events);
  let scored = 0, sumRisk = 0, firstActiveTick = -1, gallery = 0;
  const risks: number[] = [];
  for (let i = 0; i < batches.length; i++) {
    const r = await runSapimouseModule(sid, batches[i]);
    gallery = Number(r.detail.gallery_size ?? gallery);
    if (r.status === "active") {
      if (firstActiveTick < 0) firstActiveTick = i;
      scored++; sumRisk += r.risk_score; risks.push(r.risk_score);
    }
  }
  const mean = scored ? sumRisk / scored : NaN;
  console.log(`  ${label.padEnd(26)} ticks=${batches.length}  gallery=${gallery}` +
    `  scored=${scored}  mean risk=${scored ? mean.toFixed(3) : "n/a"}` +
    (firstActiveTick >= 0 ? `  active from tick ${firstActiveTick}` : ""));
  return { mean, scored, risks, gallery };
}

async function main() {
  // several pairs, so a clean separation is not one lucky draw
  const PAIRS: [string, string][] = [["user7", "user23"], ["user31", "user58"], ["user90", "user12"]];
  console.log(`warm-up target: ${SAPIMOUSE_WARMUP_SIZE} gallery windows\n`);

  let fail = 0;
  const check = (ok: boolean, msg: string) => { if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
  const rows: { pair: string; genuine: number; impostor: number; margin: number }[] = [];

  for (const [USER, IMPOSTOR] of PAIRS) {
    const a = sessionFiles(USER), b = sessionFiles(IMPOSTOR);
    const sid = `live-test-${USER}`;
    await resetSapimouse(sid);
    console.log(`${USER} enrolled, ${IMPOSTOR} as impostor:`);
    const warm = await replay(sid, loadCsv(a.long), `${USER} 3min (warm-up)`);
    const genuine = await replay(sid, loadCsv(a.short), `${USER} 1min (genuine)`);
    const impostor = await replay(sid, loadCsv(b.short), `${IMPOSTOR} 1min (impostor)`);
    console.log();
    check(warm.gallery >= SAPIMOUSE_WARMUP_SIZE, `${USER}: warm-up filled the gallery (${warm.gallery}/${SAPIMOUSE_WARMUP_SIZE})`);
    check(genuine.scored > 0 && impostor.scored > 0, `${USER}: both sessions produced scores`);
    check(impostor.mean > genuine.mean,
      `${USER}: impostor risk above genuine (${impostor.mean.toFixed(3)} > ${genuine.mean.toFixed(3)})`);
    rows.push({ pair: `${USER} vs ${IMPOSTOR}`, genuine: genuine.mean, impostor: impostor.mean,
                margin: impostor.mean - genuine.mean });
    console.log();
  }

  console.log("summary (mean live risk):");
  for (const r of rows) {
    console.log(`  ${r.pair.padEnd(20)} genuine ${r.genuine.toFixed(3)}   impostor ${r.impostor.toFixed(3)}   margin ${r.margin >= 0 ? "+" : ""}${r.margin.toFixed(3)}`);
  }
  console.log(fail === 0 ? "\nLIVE ENGINE OK" : `\n${fail} CHECK(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
