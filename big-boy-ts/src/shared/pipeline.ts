/**
 * The one entry point both sides of the system call.
 *
 * Training reaches it through the SapiMouse loader; the browser reaches it
 * through the pointer recorder. If this function is the only path from events
 * to features, train/test skew cannot creep in through a second code path.
 */

import { extractStrokeFeatures } from "./features.ts";
import { DEFAULT_SEGMENT_CONFIG, segmentStrokes, type SegmentConfig } from "./strokes.ts";
import type { InputEvent, Stroke } from "./types.ts";

export type PipelineOptions = {
  /** Viewport diagonal in the same units as the event coordinates (§3.3). */
  diagonal: number;
  segment?: SegmentConfig;
};

export type ExtractedStroke = { stroke: Stroke; features: Float32Array };

/** Events → strokes → feature vectors, dropping strokes too short to describe. */
export function extractFromEvents(
  events: InputEvent[],
  options: PipelineOptions,
): ExtractedStroke[] {
  const strokes = segmentStrokes(
    events,
    options.diagonal,
    options.segment ?? DEFAULT_SEGMENT_CONFIG,
  );
  return extractFromStrokes(strokes, options);
}

/** The same, for callers that already hold segmented strokes (e.g. augmentation). */
export function extractFromStrokes(
  strokes: Stroke[],
  options: PipelineOptions,
): ExtractedStroke[] {
  const out: ExtractedStroke[] = [];
  for (const stroke of strokes) {
    const features = extractStrokeFeatures(stroke, { diagonal: options.diagonal });
    if (features) out.push({ stroke, features });
  }
  return out;
}
