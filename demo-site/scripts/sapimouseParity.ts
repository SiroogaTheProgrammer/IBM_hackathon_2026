/**
 * Parity check: run the same raw sessions through the TypeScript port and
 * compare against what Python produced, at three levels.
 *
 *   npx tsx scripts/sapimouseParity.ts
 *
 * A wrong formula in any one of the 60 features would shift every score while
 * still looking plausible at runtime, so this is the only thing standing between
 * "the JS runs" and "the JS means what the benchmark measured".
 */
import fixture from "../src/lib/biometrics/sapimouse/model/sapimouse-parity.json";
import { CONFIG, PREP, embedSession } from "../src/lib/biometrics/sapimouse";
import { cleanEvents, segmentStrokes } from "../src/lib/biometrics/sapimouse/segment";
import { strokeFeatures } from "../src/lib/biometrics/sapimouse/features";
import { applyPreprocessor } from "../src/lib/biometrics/sapimouse/preprocess";
import modelJson from "../src/lib/biometrics/sapimouse/model/sapimouse-encoder.json";
import type { RawEvent } from "../src/lib/biometrics/sapimouse/types";

type Case = {
  user: string; file: string;
  events: { t: number[]; button: string[]; state: string[]; x: number[]; y: number[] };
  n_strokes: number;
  raw_features: Record<string, (number | null)[]>;
  scaled: number[][];
  embeddings: number[][];
  session_embedding: number[];
};

const M = modelJson as unknown as { preprocess: Parameters<typeof applyPreprocessor>[1] };
const cases = (fixture as unknown as { cases: Case[] }).cases;

const TOL_FEATURE = 1e-4;     // relative, on values spanning many orders of magnitude
const TOL_SCALED = 1e-4;
const TOL_EMBED = 2e-4;

function toEvents(c: Case): RawEvent[] {
  // the fixture stores the raw CSV column in milliseconds, as captured
  return c.events.t.map((t, i) => ({
    t: t * 1e-3, x: c.events.x[i], y: c.events.y[i],
    button: c.events.button[i], state: c.events.state[i],
  }));
}

function relDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  return d / Math.max(1, Math.abs(a), Math.abs(b));
}

let failures = 0;
const report = (ok: boolean, label: string, detail: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label.padEnd(34)} ${detail}`);
};

for (const c of cases) {
  console.log(`\n${c.user}/${c.file}  (${c.events.t.length} events)`);
  const events = toEvents(c);

  // --- 1. segmentation -----------------------------------------------------
  const strokes = segmentStrokes(cleanEvents(events, PREP), CONFIG);
  const feats = strokes
    .filter((s) => {
      if (s.t.length < CONFIG.min_points) return false;
      let p = 0;
      for (let i = 1; i < s.x.length; i++) p += Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
      if (p < CONFIG.min_path_px) return false;
      return s.t[s.t.length - 1] - s.t[0] >= CONFIG.min_duration_s;
    })
    .map((s) => strokeFeatures(s, CONFIG))
    .filter((f) => {
      if (f.v_max !== null && f.v_max > PREP.max_speed_px_s) return false;
      if (f.path_len !== null && f.path_len > PREP.max_path_px) return false;
      if (PREP.drop_zero_var_strokes && (f.v_std === 0 || f.bbox_area === 0)) return false;
      return f.duration !== null && Number.isFinite(f.duration) && f.duration > 0;
    });
  report(feats.length === c.n_strokes, "stroke count",
         `ts=${feats.length} py=${c.n_strokes}`);
  if (feats.length !== c.n_strokes) continue;

  // --- 2. each of the 60 features ------------------------------------------
  let worstName = "", worst = 0, nullMismatch = 0;
  for (const [name, pyVals] of Object.entries(c.raw_features)) {
    for (let i = 0; i < pyVals.length; i++) {
      const py = pyVals[i], ts = feats[i][name] ?? null;
      if (py === null || ts === null) {
        if ((py === null) !== (ts === null)) nullMismatch++;
        continue;
      }
      const d = relDiff(py, ts as number);
      if (d > worst) { worst = d; worstName = `${name}[${i}]`; }
    }
  }
  report(worst < TOL_FEATURE && nullMismatch === 0, "60 raw features",
         `worst rel diff ${worst.toExponential(2)} at ${worstName || "-"}, ` +
         `${nullMismatch} NaN mismatches`);

  // --- 3. preprocessing ----------------------------------------------------
  const scaled = applyPreprocessor(feats, M.preprocess);
  let sWorst = 0;
  scaled.forEach((row, i) =>
    row.forEach((v, j) => { sWorst = Math.max(sWorst, relDiff(c.scaled[i][j], v)); }));
  report(sWorst < TOL_SCALED, "scaled feature matrix", `worst ${sWorst.toExponential(2)}`);

  // --- 4. the encoder ------------------------------------------------------
  const z = embedSession(events);
  report(z.length === c.embeddings.length, "window count",
         `ts=${z.length} py=${c.embeddings.length}`);
  let eWorst = 0;
  const n = Math.min(z.length, c.embeddings.length);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < z[i].length; j++)
      eWorst = Math.max(eWorst, Math.abs(z[i][j] - c.embeddings[i][j]));
  report(eWorst < TOL_EMBED, "window embeddings", `max abs diff ${eWorst.toExponential(2)}`);

  // cosine against the Python session embedding: the number verify() acts on
  const acc = new Float32Array(z[0].length);
  z.forEach((v) => v.forEach((q, i) => { acc[i] += q / z.length; }));
  let norm = Math.sqrt(acc.reduce((a, q) => a + q * q, 0));
  const sess = Array.from(acc).map((q) => q / norm);
  const cos = sess.reduce((a, q, i) => a + q * c.session_embedding[i], 0);
  report(Math.abs(1 - cos) < 1e-5, "session embedding cosine", `cos=${cos.toFixed(9)}`);
}

console.log(failures === 0
  ? "\nPARITY OK - the TypeScript pipeline reproduces Python end to end"
  : `\n${failures} PARITY FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
