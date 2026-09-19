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

export type TickPayload = {
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
