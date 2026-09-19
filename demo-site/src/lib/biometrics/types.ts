/**
 * Shared request/response shapes for the serverless biometrics engine.
 * `TickResponse` intentionally mirrors the exact JSON shape the original
 * Python demo (`demo/server.py`'s `/api/tick`) returned, so
 * `BiometricsWidget.tsx` (written against that shape) needs no changes.
 */

export type MouseEvent2D = {
  t: number;
  x: number;
  y: number;
  button: string;
  state: string;
};

export type KeySample = {
  key: string;
  dwell: number;
  flight: number;
};

export type NavSample = {
  tab: string;
  dwell: number;
};

export type DeviceSample = {
  blur_count?: number;
  resize_count?: number;
  screen?: string;
};

/**
 * Which mouse model scores this session.
 *
 * - `balabit_features_embed`: the 32-feature window extractor + trained
 *   siamese encoder, scored against a gallery of the user's own embeddings.
 * - `balabit_autoencoder`: a per-session autoencoder trained on the user's
 *   own warm-up windows, scored by reconstruction error.
 * - `sapimouse_features_embed`: the 60-feature stroke extractor + the encoder
 *   trained on SapiMouse (90 users, ~59 Hz), run on TensorFlow.js. Same
 *   gallery-and-distance scoring as `balabit_features_embed`; it differs in
 *   that a window is 12 segmented strokes rather than one tick, so it needs
 *   ~15 s of movement before it can score at all.
 * - `little_boy`: the direct port of `ML_Models/train_pipeline_1.py` - one row
 *   per raw event ([x, y, time_delta, button_*, state_*]), plain
 *   StandardScaler, the original 32-16-8 bottleneck. Same reconstruction-error
 *   idea as `balabit_autoencoder`, but on per-event rows rather than window
 *   aggregates, and trained on a longer (~90 s) capture.
 *
 * Only the mouse module differs; tab-navigation and keystroke run the same
 * whichever is selected, so composite risk stays comparable between them.
 */
export type MouseEngine =
  | "balabit_features_embed"
  | "balabit_autoencoder"
  | "sapimouse_features_embed"
  | "little_boy";

export const DEFAULT_ENGINE: MouseEngine = "balabit_features_embed";

export type TickPayload = {
  engine?: MouseEngine;
  events?: MouseEvent2D[];
  nav?: NavSample[];
  keys?: KeySample[];
  device?: DeviceSample;
};

export type ModuleStatus = "active" | "warming" | "inactive" | "error";

export type ModuleResult = {
  plugin_id: string;
  risk_score: number;
  confidence: number;
  status: ModuleStatus;
  detail: Record<string, unknown>;
};

export type SessionInfo = {
  status: string;
  gallery_size: number;
  warmup_size: number;
  gallery_mode: string;
};

export type Verdict = "ALLOW" | "ESCALATE" | "IDLE";

export type TickResponse = {
  idle?: boolean;
  composite_risk: number | null;
  verdict: Verdict;
  streak: number;
  escalated: boolean;
  threshold: number;
  hard_triggered: string | null;
  active_modules: number;
  modules: ModuleResult[];
  session: SessionInfo;
};
