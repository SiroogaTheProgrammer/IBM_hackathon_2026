/**
 * Public surface of the browser-safe half of this project.
 *
 * The demo site imports from here and gets exactly the code that produced the
 * training features — see `README.md` §"Using the encoder in the browser".
 */

export type {
  Button,
  InputEvent,
  PointerSample,
  Scaler,
  Stroke,
  StrokeContext,
  StrokeFeatureRow,
  Terminator,
} from "./types.ts";

export { FRAME_MS, FRAME_S, resample60Hz } from "./resample.ts";
export {
  DEFAULT_SEGMENT_CONFIG,
  segmentStrokes,
  type SegmentConfig,
} from "./strokes.ts";
export {
  FEATURE_COUNT,
  FEATURE_NAMES,
  FEATURE_VERSION,
  extractStrokeFeatures,
  type FeatureName,
} from "./features.ts";
export {
  applyScaler,
  assertScalerMatches,
  fitScaler,
} from "./standardize.ts";
export {
  extractFromEvents,
  extractFromStrokes,
  type ExtractedStroke,
  type PipelineOptions,
} from "./pipeline.ts";
export {
  StrokeEncoder,
  cosine,
  l2normalize,
  poolEmbeddings,
  type EncoderBundle,
  type TfNamespace,
} from "./embed.ts";
export {
  asNorm,
  logLikelihoodRatio,
  sprtThresholds,
  type CohortIndex,
  type LlrModel,
} from "./score.ts";
