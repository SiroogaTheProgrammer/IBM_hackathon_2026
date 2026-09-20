/**
 * SapiMouse loader: CSV rows → the same `InputEvent` stream the browser emits.
 *
 * Layout expected under `data/sapimouse/`:
 *
 *   user1/session_2020_05_14_1min.csv
 *   user1/session_2020_05_14_3min.csv
 *   ...
 *
 * with columns `client timestamp,button,state,x,y`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Button, InputEvent } from "../shared/types.ts";

export type Session = {
  subject: string;
  /** `user7/session_2020_05_14_3min` — unique across the dataset. */
  session: string;
  /** Nominal length in minutes, parsed from the filename (1, 3 or 5). */
  minutes: number;
  events: InputEvent[];
  /** Estimated screen diagonal for this recording, in pixels (§3.3). */
  diagonal: number;
  path: string;
};

/**
 * Fallback when a session's coordinate spread is too small to estimate from —
 * SapiMouse was collected on standard desktop displays.
 */
const FALLBACK_SCREEN: [number, number] = [1920, 1080];

/** Below this observed extent (px) the estimate is not trusted. */
const MIN_TRUSTED_EXTENT = 600;

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
 * Estimate the screen the session was recorded on.
 *
 * SapiMouse ships no resolution metadata and the observed maxima range from
 * ~900 px to ~2550 px wide across the 120 users, so a single hard-coded
 * resolution would mis-scale a third of the corpus. Using a high percentile of
 * the observed extent is the honest approximation: over one to three minutes of
 * continuous mouse work the cursor sweeps most of the usable area, which is the
 * same quantity the demo normalises by (its fixed logical canvas).
 *
 * This is an approximation and it is the largest single source of domain gap
 * left in the pipeline — hence the scale augmentation in `augment.ts`, which
 * teaches the encoder not to lean on absolute scale in the first place.
 */
export function estimateScreen(
  xs: number[],
  ys: number[],
): { width: number; height: number; diagonal: number } {
  const quantile = (values: number[], q: number): number => {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round(q * (sorted.length - 1))),
    );
    return sorted[index]!;
  };

  const width = quantile(xs, 0.999);
  const height = quantile(ys, 0.999);

  const useWidth = width >= MIN_TRUSTED_EXTENT ? width : FALLBACK_SCREEN[0];
  const useHeight = height >= MIN_TRUSTED_EXTENT / 2 ? height : FALLBACK_SCREEN[1];

  return {
    width: useWidth,
    height: useHeight,
    diagonal: Math.hypot(useWidth, useHeight),
  };
}

/** Parse one session CSV. Returns `null` for a file with no usable rows. */
export function loadSessionFile(path: string, subject: string, session: string): Session | null {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  const events: InputEvent[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let held = false;
  let lastT = Number.NEGATIVE_INFINITY;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 5) continue;

    const t = Number(parts[0]);
    const x = Number(parts[3]);
    const y = Number(parts[4]);
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;

    // A handful of files concatenate recordings and the clock jumps backwards;
    // dropping those rows is safer than letting a negative dt reach a speed.
    if (t < lastT) continue;
    lastT = t;

    const button = parseButton(parts[1] ?? "");
    const state = (parts[2] ?? "").trim();

    let kind: InputEvent["kind"] = "move";
    if (state === "Pressed") {
      kind = "down";
      held = true;
    } else if (state === "Released") {
      kind = "up";
      held = false;
    }

    events.push({ t, x, y, kind, button, dragging: state === "Drag" || held });
    xs.push(x);
    ys.push(y);
  }

  if (events.length < 50) return null;

  const minutes = Number(/_(\d+)min/.exec(session)?.[1] ?? 0);
  const { diagonal } = estimateScreen(xs, ys);

  return { subject, session, minutes, events, diagonal, path };
}

/** Walk `root` and load every session, sorted for a deterministic ordering. */
export function loadSapiMouse(root: string): Session[] {
  const sessions: Session[] = [];

  const userDirs = readdirSync(root)
    .filter((name) => name.startsWith("user"))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));

  for (const user of userDirs) {
    const files = readdirSync(join(root, user))
      .filter((name) => name.endsWith(".csv"))
      .sort();
    for (const file of files) {
      const name = file.replace(/\.csv$/, "");
      const session = loadSessionFile(join(root, user, file), user, `${user}/${name}`);
      if (session) sessions.push(session);
    }
  }

  return sessions;
}
