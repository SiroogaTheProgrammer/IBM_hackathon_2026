import type { StandardScaler } from "./scaler";

/**
 * The tf.js equivalent of the three artefacts train_pipeline_1.py writes per
 * user - `autoencoder_user_<id>_test.pth`, `feature_cols_<id>.json` and
 * `scaler_<id>.pkl` - as one JSON document, so a profile can live in Redis.
 *
 * Structurally compatible with `autoencoder/types.ts`'s `UserProfile["model"]`,
 * which lets this module reuse `autoencoder/store.ts` for (de)serialisation.
 */
export interface LittleBoyProfile {
  userId: string;
  model: { topology: unknown; weightSpecs: unknown; weightDataB64: string };
  scaler: StandardScaler;
  /** Column layout the model was fitted on, for the same reason
   * `feature_cols_<id>.json` exists: a profile is only valid against a matrix
   * built with the identical vocabulary. */
  featureCols: readonly string[];
  /**
   * Reconstruction-error statistics over the held-out genuine tail.
   *
   * Calibrated on *blocks* of `blockRows` consecutive rows, not on single rows,
   * because that is the shape scoring actually presents: a live tick is ~50
   * events and is scored by their mean error. Averaging n rows shrinks the
   * spread by sqrt(n), so a per-row sigma would understate every z-score by
   * roughly 7x and the engine would look flat no matter who was at the mouse.
   */
  threshold: {
    /** Mean of the per-block mean errors. */
    mean: number;
    /** Standard deviation of the per-block mean errors. */
    std: number;
    /** Block-level error above which a tick is called an impostor. */
    cutoff: number;
    /** Per-row mean + k*sigma, kept for the anomalous-row diagnostic only. */
    rowCutoff: number;
    /** Rows per calibration block - the tick size this was calibrated for. */
    blockRows: number;
  };
  trainedAt: number;
  trainRows: number;
  epochs: number;
}
