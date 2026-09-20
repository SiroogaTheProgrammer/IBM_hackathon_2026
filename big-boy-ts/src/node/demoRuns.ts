/**
 * Loader for runs recorded on the demo site (description.md §6.4).
 *
 * The demo writes the same five SapiMouse columns plus four of its own:
 *
 *   client timestamp,button,state,x,y,task,subtask,element,viewport_w,viewport_h
 *
 * The extra columns are the whole point. `subtask` is §2.1's alignment key —
 * the thing the public datasets cannot provide and the reason this collection
 * is "the highest-leverage data collection available". Everything downstream
 * indexes on it.
 *
 * Unlike SapiMouse, the viewport is recorded rather than estimated, so §3.3's
 * normalisation is exact here instead of a percentile guess.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Button, InputEvent } from "../shared/types.ts";

export type DemoRun = {
  /**
   * Identity. One recording per participant in the collection so far, so this
   * is the file stem — but it is a separate field because the moment anyone
   * records a second run it stops being one (§6.4 wants runs 2 and 3 of the
   * same person, and those must share a subject).
   */
  subject: string;
  /** Unique per recording. */
  run: string;
  /** Sub-task id → its event stream, in flow order. */
  subtasks: Map<string, InputEvent[]>;
  viewport: { width: number; height: number; diagonal: number };
  /** Wall-clock length of the whole run, in seconds. */
  seconds: number;
  path: string;
};

function parseButton(raw: string): Button {
  switch (raw.trim()) {
    case "Left":
      return "left";
    case "Right":
      return "right";
    case "Middle":
      return "middle";
    default:
      return "none";
  }
}

/**
 * Split one recorded run into its sub-task streams.
 *
 * A row's `subtask` column says which sub-task was current when the sample was
 * taken, so the segmentation is the demo engine's own and needs no
 * reconstruction here.
 */
export function parseDemoRun(path: string, subject?: string): DemoRun | null {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split(",").map((column) => column.trim());

  const column = (name: string): number => header.indexOf(name);
  const tIndex = column("client timestamp");
  const subtaskIndex = column("subtask");
  if (tIndex === -1 || subtaskIndex === -1) return null;

  const buttonIndex = column("button");
  const stateIndex = column("state");
  const xIndex = column("x");
  const yIndex = column("y");
  const widthIndex = column("viewport_w");
  const heightIndex = column("viewport_h");

  const subtasks = new Map<string, InputEvent[]>();
  let held = false;
  let lastT = Number.NEGATIVE_INFINITY;
  let first = Number.NaN;
  let last = Number.NaN;
  let width = 0;
  let height = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");

    const t = Number(parts[tIndex]);
    const x = Number(parts[xIndex]);
    const y = Number(parts[yIndex]);
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    // A clock that jumps backwards would produce a negative dt and a nonsense
    // speed; dropping the row is safer than letting it reach a feature.
    if (t < lastT) continue;
    lastT = t;

    if (!Number.isFinite(first)) first = t;
    last = t;

    const w = Number(parts[widthIndex]);
    const h = Number(parts[heightIndex]);
    if (Number.isFinite(w) && w > 0) width = w;
    if (Number.isFinite(h) && h > 0) height = h;

    const state = (parts[stateIndex] ?? "").trim();
    let kind: InputEvent["kind"] = "move";
    if (state === "Pressed") {
      kind = "down";
      held = true;
    } else if (state === "Released") {
      kind = "up";
      held = false;
    }

    const subtaskId = (parts[subtaskIndex] ?? "").trim();
    // Rows outside any sub-task (before the run armed, between steps) have an
    // empty key and belong to no alignment slot.
    if (!subtaskId) continue;

    const event: InputEvent = {
      t,
      x,
      y,
      kind,
      button: parseButton(parts[buttonIndex] ?? ""),
      dragging: state === "Drag" || held,
    };

    const bucket = subtasks.get(subtaskId);
    if (bucket) bucket.push(event);
    else subtasks.set(subtaskId, [event]);
  }

  if (subtasks.size === 0) return null;

  const stem = basename(path).replace(/\.csv$/i, "");
  return {
    subject: subject ?? stem,
    run: stem,
    subtasks,
    viewport: { width, height, diagonal: Math.hypot(width, height) },
    seconds: Number.isFinite(first) ? (last - first) / 1000 : 0,
    path,
  };
}

/**
 * Optional identity manifest, for when the same person records more than once.
 *
 * ```json
 * { "user-1": "alice", "user-2": "alice", "user-4": "bob" }
 * ```
 *
 * Without it every file is its own subject, which is the state of the
 * collection today and the reason §6.4's genuine distribution cannot be fitted
 * from it — see `calibrate.ts`.
 */
export function loadSubjects(path: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!path) return map;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  for (const [run, subject] of Object.entries(raw)) map.set(run, subject);
  return map;
}

/** Load every `*.csv` in a directory as a recorded run. */
export function loadDemoRuns(
  directory: string,
  subjects: Map<string, string> = new Map(),
): DemoRun[] {
  const runs: DemoRun[] = [];

  for (const name of readdirSync(directory).sort()) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const stem = name.replace(/\.csv$/i, "");
    const run = parseDemoRun(join(directory, name), subjects.get(stem));
    if (run) runs.push(run);
  }

  return runs;
}
