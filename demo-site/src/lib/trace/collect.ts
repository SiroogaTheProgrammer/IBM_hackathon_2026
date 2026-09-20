/**
 * Data-collection mode: dump one whole run of the flow as a SapiMouse-shaped
 * CSV, for the calibration collection in `description.md` §6.4.
 *
 * ## Why this shape
 *
 * The public SapiMouse sessions in `big-boy-ts/data/sapimouse` look like this:
 *
 * ```
 * client timestamp,button,state,x,y
 * 47972,NoButton,Move,810,198
 * 48042,Left,Pressed,810,196
 * 48125,Left,Released,810,196
 * ```
 *
 * Three properties of that logger are worth copying exactly, because anything
 * that reads both datasets has to treat them identically:
 *
 *  - **Event-driven, not fixed-rate.** Measured on `user108`: 17 ms and 16 ms
 *    are by far the commonest gaps (~60 Hz *while the mouse is moving*), but
 *    190 gaps exceed 50 ms and the largest is 1235 ms — nothing is emitted
 *    while the cursor sits still. Average over a whole session is only ~37
 *    rows/s. So this logger emits on `pointermove` (expanded through
 *    `getCoalescedEvents()`), never on a timer.
 *  - **Presses are their own rows**, at their own timestamps, carrying the
 *    position but no movement.
 *  - **Integers throughout**, and a monotonic millisecond clock with an
 *    arbitrary origin — `event.timeStamp` is already exactly that.
 *
 * ## What we add
 *
 * Columns 6 onwards are ours: the task and sub-task that were current when the
 * sample was taken, the element a click landed on, and the viewport. The first
 * five columns are byte-for-byte SapiMouse, so a loader that reads only those
 * needs no changes to ingest our files.
 */

export const CSV_COLUMNS = [
  /* --- SapiMouse, exactly --- */
  "client timestamp",
  "button",
  "state",
  "x",
  "y",
  /* --- ours --- */
  "task",
  "subtask",
  "element",
  "viewport_w",
  "viewport_h",
] as const;

export type ButtonName = "NoButton" | "Left" | "Right" | "Middle";
export type SampleState = "Move" | "Pressed" | "Released" | "Drag";

export type LogRow = {
  t: number;
  button: ButtonName;
  state: SampleState;
  x: number;
  y: number;
  /** Task id (`"1"`…`"5"`), or `""` between sub-tasks. */
  task: string;
  /** Sub-task alignment key (`"2.3"`), or `""`. */
  subtask: string;
  /** `data-trace` of the clicked element, else a short CSS description. */
  element: string;
  viewportW: number;
  viewportH: number;
};

/** What the logger asks the run engine for on every sample. */
export type RunPosition = { task: string; subtask: string };

/* ------------------------------------------------------------ localhost --- */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

/**
 * Collection mode is a research tool, not a product feature: it records every
 * cursor position of whoever is at the machine and writes a file to their
 * disk. Gating it on localhost keeps it off any deployed copy of the demo.
 */
export function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTS.has(window.location.hostname);
}

/* --------------------------------------------------- participant counter --- */

const PARTICIPANT_KEY = "trace.participant";

let participantCache: number | null = null;
const participantListeners = new Set<() => void>();

function readParticipant(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(PARTICIPANT_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    /* private mode, blocked storage — the counter is a convenience only */
    return 1;
  }
}

/** Next participant number, i.e. the `n` in `user-{n}.csv`. */
export function getParticipant(): number {
  if (participantCache === null) participantCache = readParticipant();
  return participantCache;
}

export function getParticipantServerSnapshot(): number {
  return 1;
}

export function subscribeParticipant(listener: () => void): () => void {
  participantListeners.add(listener);
  return () => participantListeners.delete(listener);
}

function setParticipant(value: number): void {
  participantCache = value;
  try {
    window.localStorage.setItem(PARTICIPANT_KEY, String(value));
  } catch {
    /* keep the in-memory counter; the file name is still correct this session */
  }
  for (const listener of participantListeners) listener();
}

/** Called once a run's file has been written. */
export function advanceParticipant(): void {
  setParticipant(getParticipant() + 1);
}

/* -------------------------------------------------------------- logging --- */

const BUTTONS: ButtonName[] = ["Left", "Middle", "Right"];

function buttonName(buttons: number): ButtonName {
  if (buttons & 1) return "Left";
  if (buttons & 2) return "Right";
  if (buttons & 4) return "Middle";
  return "NoButton";
}

/** A short, stable description of whatever was clicked. */
export function describeElement(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "";

  const anchored = target.closest<HTMLElement>("[data-trace]");
  if (anchored?.dataset.trace) return anchored.dataset.trace;

  if (target.id) return `#${target.id}`;

  const tag = target.tagName.toLowerCase();
  const classes =
    typeof target.className === "string"
      ? target.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];

  return classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
}

/**
 * Records one full run. `position` is read at sample time rather than pushed,
 * so the logger never has to be told when the flow advances.
 */
export class SessionLogger {
  private rows: LogRow[] = [];
  private readonly position: () => RunPosition;
  private detach: (() => void) | null = null;

  constructor(position: () => RunPosition) {
    this.position = position;
  }

  get sampleCount(): number {
    return this.rows.length;
  }

  /** Seconds between the first and last sample. */
  get durationSeconds(): number {
    const first = this.rows[0];
    const last = this.rows[this.rows.length - 1];
    if (!first || !last) return 0;
    return (last.t - first.t) / 1000;
  }

  private push(
    event: { timeStamp: number; clientX: number; clientY: number },
    button: ButtonName,
    state: SampleState,
    element: string,
  ): void {
    const { task, subtask } = this.position();
    this.rows.push({
      t: Math.round(event.timeStamp || performance.now()),
      button,
      state,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      task,
      subtask,
      element,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    });
  }

  start(): void {
    if (this.detach) return;
    this.rows = [];

    const onMove = (event: PointerEvent) => {
      const held = buttonName(event.buttons);
      const state: SampleState = held === "NoButton" ? "Move" : "Drag";
      /*
       * Coalesced events are the whole point: without them the browser hands
       * over one position per frame and the 60 Hz detail SapiMouse has is gone.
       */
      const points =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      const samples = points.length > 0 ? points : [event];
      for (const sample of samples) this.push(sample, held, state, "");
    };

    const onDown = (event: PointerEvent) => {
      const button = BUTTONS[event.button] ?? "Left";
      this.push(event, button, "Pressed", describeElement(event.target));
    };

    const onUp = (event: PointerEvent) => {
      const button = BUTTONS[event.button] ?? "Left";
      this.push(event, button, "Released", describeElement(event.target));
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    this.detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  toCsv(): string {
    const lines = [CSV_COLUMNS.join(",")];
    for (const row of this.rows) {
      lines.push(
        [
          row.t,
          row.button,
          row.state,
          row.x,
          row.y,
          row.task,
          row.subtask,
          csvField(row.element),
          row.viewportW,
          row.viewportH,
        ].join(","),
      );
    }
    return `${lines.join("\n")}\n`;
  }
}

/** Quote a field only when it would otherwise break the row. */
function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/* ------------------------------------------------------------- download --- */

export type SaveStatus = "saving" | "saved" | "failed";

export type SavedRun = {
  /** Distinguishes this save from a later one when a response arrives late. */
  id: number;
  participant: number;
  status: SaveStatus;
  /** Where the run landed, once the server has said so. */
  path: string;
  /** Why the write failed, when `status` is `"failed"`. */
  error: string;
  rows: number;
  seconds: number;
  /**
   * Kept in memory after the run so the file can be written again without
   * re-recording. If the dev server is not reachable, the whole session would
   * otherwise be lost, and a session costs three minutes of someone's time.
   */
  csv: string;
};

/**
 * Ask the dev server to write the run to `data/collected/`. The server names
 * the file and answers with the path it actually used, which may carry a
 * `-2` suffix if that participant number was already on disk.
 */
export async function postRun(
  participant: number,
  csv: string,
): Promise<string> {
  const response = await fetch("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant, csv }),
  });

  const payload = (await response.json().catch(() => null)) as {
    path?: string;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Server answered ${response.status}`);
  }
  if (!payload?.path) {
    throw new Error("Server did not say where the run was written");
  }

  return payload.path;
}

/** Fallback when the server cannot be reached: save through the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  /* Revoking immediately can cancel the download in some browsers. */
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Snapshot a finished run, ready to be written out. */
export function pendingRun(
  logger: SessionLogger,
  participant: number,
  id: number,
): SavedRun {
  return {
    id,
    participant,
    status: "saving",
    path: "",
    error: "",
    rows: logger.sampleCount,
    seconds: Math.round(logger.durationSeconds),
    csv: logger.toCsv(),
  };
}
