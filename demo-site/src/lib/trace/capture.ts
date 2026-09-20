/**
 * Client capture for one sub-task (description.md §3.1).
 *
 * This file used to own a second, hand-written feature extractor. It does not
 * any more, and that is the point: the features are computed by
 * `big-boy-ts/src/shared`, the *same compiled code* that produced the training
 * features. §3.2 exists because a kinematic feature computed on raw samples is
 * a different signal at 17 ms (SapiMouse) than at 4 ms (coalesced
 * `pointermove`); a second implementation in another language — or in another
 * directory — is that same failure one level up.
 *
 * So all this module does is turn browser pointer events into the encoder's
 * `InputEvent` shape, exactly as the SapiMouse CSV loader does on the offline
 * side, and hand them to `extractFromEvents`.
 */

import { DEFAULT_SEGMENT_CONFIG, extractFromEvents } from "@encoder/index";
import type { Button, ExtractedStroke, InputEvent } from "@encoder/index";

/** Browser button index → the encoder's button name. */
const BUTTONS: Button[] = ["left", "middle", "right"];

function heldButton(buttons: number): Button {
  if (buttons & 1) return "left";
  if (buttons & 2) return "right";
  if (buttons & 4) return "middle";
  return "none";
}

/**
 * The geometry a run was captured under (§3.3).
 *
 * §3.3 asks for a locked logical canvas so enrollment and test are exactly
 * comparable. This demo renders at whatever size the window happens to be, so
 * instead the viewport is *recorded*: distances are normalised by the diagonal,
 * and a mismatch between enrollment and test widens the decision thresholds
 * rather than counting as evidence of an impostor.
 */
export type Viewport = {
  width: number;
  height: number;
  /** Viewport diagonal — the length every distance feature is divided by. */
  diagonal: number;
  devicePixelRatio: number;
  /** "mouse" | "pen" | "touch", from the pointer events themselves. */
  pointerType: string;
};

export function readViewport(pointerType = "unknown"): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    diagonal: Math.hypot(window.innerWidth, window.innerHeight),
    devicePixelRatio: window.devicePixelRatio,
    pointerType,
  };
}

/** Two runs are geometrically comparable when the viewport has not moved. */
export function viewportsMatch(a: Viewport, b: Viewport): boolean {
  return a.width === b.width && a.height === b.height;
}

/* ------------------------------------------------------------ recording --- */

/**
 * Accumulates the raw event stream of the sub-task currently in progress. One
 * instance per sub-task; the run engine swaps it out on every advance.
 */
export class SubtaskRecorder {
  readonly subtaskId: string;
  readonly startedAt: number;

  private events: InputEvent[] = [];
  private held = false;
  /** Whichever pointer hardware the participant actually used (§6.4). */
  private pointerType = "unknown";

  constructor(subtaskId: string, startedAt: number = performance.now()) {
    this.subtaskId = subtaskId;
    this.startedAt = startedAt;
  }

  get eventCount(): number {
    return this.events.length;
  }

  get observedPointerType(): string {
    return this.pointerType;
  }

  /**
   * Feed one `pointermove`, expanded through `getCoalescedEvents()` so the
   * browser's own coalescing does not silently downsample the trajectory
   * (§3.1). The encoder resamples to a uniform 60 Hz grid afterwards, but it
   * can only resample detail that was captured in the first place.
   */
  addMove(event: PointerEvent): void {
    if (event.pointerType) this.pointerType = event.pointerType;

    const held = heldButton(event.buttons);
    const coalesced =
      typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : [];
    const samples = coalesced.length > 0 ? coalesced : [event];

    for (const sample of samples) {
      this.events.push({
        t: sample.timeStamp || performance.now(),
        x: sample.clientX,
        y: sample.clientY,
        kind: "move",
        button: held,
        dragging: held !== "none" || this.held,
      });
    }
  }

  addDown(event: PointerEvent): void {
    this.held = true;
    this.push(event, "down");
  }

  addUp(event: PointerEvent): void {
    this.push(event, "up");
    this.held = false;
  }

  private push(event: PointerEvent, kind: "down" | "up"): void {
    if (event.pointerType) this.pointerType = event.pointerType;
    this.events.push({
      t: event.timeStamp || performance.now(),
      x: event.clientX,
      y: event.clientY,
      kind,
      button: BUTTONS[event.button] ?? "left",
      dragging: this.held,
    });
  }

  /**
   * Segment and extract, through the encoder's own pipeline. Returns the
   * strokes that survived §3.4's minimum length, duration and distance — a
   * short hop to a menu item directly below its trigger routinely yields none,
   * and §6.1 would rather skip that sub-task than score it noisily.
   */
  strokes(viewport: Viewport): ExtractedStroke[] {
    if (this.events.length < DEFAULT_SEGMENT_CONFIG.minSamples) return [];
    return extractFromEvents(this.events, { diagonal: viewport.diagonal });
  }
}
