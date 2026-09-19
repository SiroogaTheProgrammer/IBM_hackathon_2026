/** Raw mouse event as captured. `t` is seconds (convert at the edge if your
 * source is milliseconds, as the SapiMouse CSVs are). */
export type RawEvent = {
  t: number;
  x: number;
  y: number;
  button: string;
  state: string;
};

export type Stroke = {
  t: number[];
  x: number[];
  y: number[];
  isDrag: boolean;
  click: ClickPair | null;
};

export type ClickPair = {
  tDown: number;
  tUp: number;
  dwell: number;
  button: string;
  cx: number;
  cy: number;
};

/** Mirrors the `Config` dataclass in mouse_auth.py. */
export type SegmentConfig = {
  pause_split_s: number;
  adaptive_pause: boolean;
  adaptive_pause_mult: number;
  split_on_click: boolean;
  max_duration_s: number;
  max_points: number;
  min_points: number;
  min_path_px: number;
  min_duration_s: number;
  dir_change_deg: number;
  stationary_px: number;
  tail_frac: number;
};

/** Mirrors the `PrepConfig` dataclass. */
export type PrepConfig = {
  x_range: [number, number];
  y_range: [number, number];
  drop_scroll: boolean;
  drop_out_of_order: boolean;
  despike: boolean;
  despike_px: number;
  despike_ratio: number;
  max_speed_px_s: number;
  max_path_px: number;
  drop_zero_var_strokes: boolean;
};

export const MOVE_STATES = new Set(["move", "drag"]);
export const DOWN_STATES = new Set(["pressed", "down"]);
export const UP_STATES = new Set(["released", "up"]);
