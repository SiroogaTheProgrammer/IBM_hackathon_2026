import type { Scaler } from "./scaler";

// BiometricsWidget.tsx already emits this exact shape, and the button/state
// strings it uses ("Left"/"Right"/"Scroll", "Move"/"Pressed"/"Released"/
// "Up"/"Down") are the same vocabulary as the training CSVs - so live events
// and dataset rows share one feature layout.
export type { MouseEvent2D as MouseEvent } from "../types";

/** Everything needed to score a session, serialisable to JSON / Redis. */
export interface UserProfile {
  userId: string;
  /** tf.js model topology + base64 weights. */
  model: { topology: unknown; weightSpecs: unknown; weightDataB64: string };
  scaler: Scaler;
  /** Reconstruction-error statistics on held-out genuine data. */
  threshold: {
    /** Mean per-row error over the genuine validation split. */
    mean: number;
    std: number;
    /** Error value above which a window is called an impostor. */
    cutoff: number;
  };
  trainedAt: number;
  trainRows: number;
  epochs: number;
}

export interface ScoreResult {
  userId: string;
  /** Mean per-row reconstruction error for the scored session. */
  error: number;
  /** (error - genuineMean) / genuineStd. Higher = less like the enrolled user. */
  z: number;
  /** Fraction of rows whose individual error exceeds the cutoff. */
  anomalousRowFraction: number;
  isImpostor: boolean;
  rows: number;
}
