/**
 * Per-event feature rows - the literal feature layout of
 * `ML_Models/train_pipeline_1.py`.
 *
 * That pipeline builds its matrix straight off the raw event log:
 *
 *   df['time_delta'] = df['record timestamp'].diff().fillna(0)
 *   df_encoded = pd.get_dummies(df, columns=['button', 'state'])
 *
 * giving one row per mouse event of `[x, y, time_delta, button_*, state_*]`.
 * This is what distinguishes `little_boy` from the sibling `balabit_autoencoder`
 * engine, which aggregates the same events into 26 window-level dynamics
 * features first. Same architecture family, different input representation.
 *
 * The column order below reproduces `ML_Models/ML_Models/feature_cols_*.json`
 * exactly (x, y, time_delta, then each one-hot group alphabetically), because
 * `get_dummies` sorts categories within a group. Fixing the vocabulary instead
 * of deriving it per session is the same thing `test_pipeline.py` does when it
 * back-fills missing dummy columns with zeros: a session where the user never
 * right-clicked must still produce a `button_Right` column, or the matrix
 * would not line up with the trained model.
 */

import type { MouseEvent2D } from "../types";

/** `button` categories, in `pd.get_dummies` order. */
export const BUTTONS = ["Left", "NoButton", "Right", "Scroll"] as const;
/** `state` categories, in `pd.get_dummies` order. */
export const STATES = ["Down", "Drag", "Move", "Pressed", "Released", "Up"] as const;

export const FEATURE_COLS: readonly string[] = [
  "x",
  "y",
  "time_delta",
  ...BUTTONS.map((b) => `button_${b}`),
  ...STATES.map((s) => `state_${s}`),
];

export const ROW_DIM = FEATURE_COLS.length; // 13

const BUTTON_OFFSET = 3;
const STATE_OFFSET = BUTTON_OFFSET + BUTTONS.length;

const BUTTON_INDEX = new Map(BUTTONS.map((b, i) => [b as string, i]));
const STATE_INDEX = new Map(STATES.map((s, i) => [s as string, i]));

/**
 * Ceiling on `time_delta`, in seconds. The one deliberate deviation from the
 * Python pipeline, and it exists because live capture has a failure mode the
 * recorded CSVs do not: the widget only emits events while the pointer is
 * actually moving, so any pause - reading the page, switching windows - lands
 * as a single multi-second gap. Unclipped, and with the plain (non-log)
 * standardisation the pipeline uses, one 40 s pause sets the column's standard
 * deviation and flattens every real inter-event interval to ~0. Five seconds is
 * far above any within-motion gap, so this only ever truncates idle time.
 */
export const MAX_TIME_DELTA_SECONDS = 5;

/**
 * Featurise one batch of events.
 *
 * `previousT` carries the timestamp of the last event of the preceding batch so
 * that `time_delta` stays continuous across tick boundaries - the Python
 * version diffs one uninterrupted recording, and chunking the same stream into
 * per-second batches must not reset the difference to 0 sixty times a minute.
 * Pass `null` for the first batch, which reproduces `.fillna(0)`.
 */
export function eventsToRows(
  events: readonly MouseEvent2D[],
  previousT: number | null = null,
): { data: Float32Array; rows: number; lastT: number | null } {
  const rows = events.length;
  const data = new Float32Array(rows * ROW_DIM);
  let prev = previousT;

  for (let i = 0; i < rows; i++) {
    const e = events[i];
    const off = i * ROW_DIM;

    data[off] = e.x;
    data[off + 1] = e.y;
    if (prev !== null) {
      const dt = e.t - prev;
      data[off + 2] = dt < 0 ? 0 : dt > MAX_TIME_DELTA_SECONDS ? MAX_TIME_DELTA_SECONDS : dt;
    }

    // An unrecognised category leaves its whole group at zero, matching how
    // test_pipeline.py drops columns outside `feature_cols`.
    const b = BUTTON_INDEX.get(e.button);
    if (b !== undefined) data[off + BUTTON_OFFSET + b] = 1;
    const s = STATE_INDEX.get(e.state);
    if (s !== undefined) data[off + STATE_OFFSET + s] = 1;

    prev = e.t;
  }

  return { data, rows, lastT: prev };
}
