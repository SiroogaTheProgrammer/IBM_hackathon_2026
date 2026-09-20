/**
 * Types shared by offline training and live browser capture.
 *
 * Everything in `src/shared` is browser-safe: no node built-ins, no imports
 * outside this directory, no dependency on TensorFlow except where a `tf`
 * namespace is passed in explicitly. The same compiled code runs over the
 * SapiMouse CSVs during training and over `pointermove` events at test time,
 * which is the only way the features can mean the same thing in both places
 * (description.md §3.2).
 */

/** One pointer position. `t` is milliseconds on a monotonic clock. */
export type PointerSample = { t: number; x: number; y: number };

/** Which physical button an event belongs to. */
export type Button = "none" | "left" | "right" | "middle";

/**
 * A single captured input event, normalised across sources. The SapiMouse
 * loader emits these from CSV rows; the browser recorder emits them from
 * `pointermove` / `pointerdown` / `pointerup`.
 */
export type InputEvent = {
  t: number;
  x: number;
  y: number;
  kind: "move" | "down" | "up";
  button: Button;
  /** True when a button was already held while moving (a drag, not a glide). */
  dragging: boolean;
};

/** Why a stroke ended — see §3.4. */
export type Terminator = "click" | "dwell" | "reversal" | "end";

/**
 * A movement segment: the unit the encoder consumes. Samples are raw (not yet
 * resampled); `extractStrokeFeatures` does the 60 Hz resampling itself so that
 * augmentation can act on the raw trajectory first.
 */
export type Stroke = {
  samples: PointerSample[];
  startedAt: number;
  endedAt: number;
  terminator: Terminator;
  dragging: boolean;
  /** Idle milliseconds between the previous stroke's end and this one's start. */
  gapBefore: number;
};

/**
 * Everything the extractor needs that is not in the trajectory itself.
 *
 * `diagonal` is the length used to make distances viewport-invariant (§3.3).
 * In the demo it is the fixed logical canvas diagonal; for a public dataset it
 * is an estimate of the screen the session was recorded on.
 */
export type StrokeContext = { diagonal: number };

/** A stroke reduced to its feature vector, with the labels needed for scoring. */
export type StrokeFeatureRow = {
  features: Float32Array;
  /** Identity label — a dataset user id, or the enrolled account at test time. */
  subject: string;
  /** Recording session / run. Two runs of the same subject share `subject`. */
  session: string;
  /**
   * Alignment key (§2.1). `task_id.subtask_id` in the demo. Public datasets
   * have no sub-tasks, so the loader synthesises pseudo sub-tasks instead.
   */
  subtaskId: string;
};

/** Standardisation statistics fitted on the training set and shipped to the client. */
export type Scaler = {
  version: string;
  names: readonly string[];
  mean: number[];
  std: number[];
};
