/** End-to-end check of the public API on real SapiMouse CSVs: enrol on the
 * 3-minute take, verify the 1-minute take, then verify someone else's. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { enrol, verify, identify, THRESHOLDS, META, type RawEvent } from "../src/lib/biometrics/sapimouse";

const ROOT = "../encoder2/data/sapimouse";

function loadCsv(path: string): RawEvent[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const head = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const [ti, bi, si, xi, yi] = ["client timestamp", "button", "state", "x", "y"].map((c) => head.indexOf(c));
  return lines.slice(1).map((l) => {
    const p = l.split(",");
    return { t: Number(p[ti]) * 1e-3, button: p[bi], state: p[si], x: Number(p[xi]), y: Number(p[yi]) };
  });
}

const users = ["user3", "user17", "user41", "user77"].filter((u) => {
  try { return readdirSync(join(ROOT, u)).length > 1; } catch { return false; }
});
console.log("model:", JSON.stringify(META));
console.log("thresholds:", JSON.stringify(THRESHOLDS), "\n");

const templates: Record<string, ReturnType<typeof enrol>> = {};
for (const u of users) {
  const files = readdirSync(join(ROOT, u)).filter((f) => f.endsWith(".csv")).sort();
  const long = files.find((f) => f.includes("3min")) ?? files[0];
  templates[u] = enrol(loadCsv(join(ROOT, u, long)));
  console.log(`enrol ${u}: ${long} -> ${templates[u].nWindows} windows`);
}

console.log();
let ok = 0, total = 0;
for (const u of users) {
  const files = readdirSync(join(ROOT, u)).filter((f) => f.endsWith(".csv")).sort();
  const short = files.find((f) => f.includes("1min")) ?? files[files.length - 1];
  const probe = loadCsv(join(ROOT, u, short));

  const g = verify(probe, templates[u]);
  total++; if (g.accept) ok++;
  console.log(`verify ${u} vs ${u}     score ${g.score.toFixed(3)}  thr ${g.threshold.toFixed(3)}  ` +
              `accept=${g.accept}  (${g.nWindows} windows)  ${g.accept ? "" : "<- MISS"}`);

  const other = users[(users.indexOf(u) + 1) % users.length];
  const i = verify(probe, templates[other]);
  total++; if (!i.accept) ok++;
  console.log(`verify ${u} vs ${other}  score ${i.score.toFixed(3)}  ` +
              `accept=${i.accept}  ${i.accept ? "<- FALSE ACCEPT" : ""}`);
}

const u0 = users[0];
const f0 = readdirSync(join(ROOT, u0)).filter((f) => f.includes("1min"))[0];
console.log(`\nidentify ${u0}/${f0}:`);
identify(loadCsv(join(ROOT, u0, f0)), templates)
  .forEach((r) => console.log(`   ${r.user.padEnd(8)} ${r.score.toFixed(3)}`));

console.log(`\n${ok}/${total} decisions correct`);
process.exit(ok === total ? 0 : 1);
