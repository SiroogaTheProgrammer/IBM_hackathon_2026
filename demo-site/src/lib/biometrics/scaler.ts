/**
 * TypeScript port of `FeatureScaler.transform` from
 * `behavioral_biometrics_nn/encoder.py`: signed-log1p, standardize with the
 * trained mean/scale, then clip. Parameters are exported once via
 * `export_web_model.py` into `model/mouseScaler.json`.
 */

import mouseScalerJson from "./model/mouseScaler.json";
import mouseScalerBigJson from "./model/mouseScalerBig.json";
import { clip, signedLog1p } from "./math";

type ScalerData = { mean: number[]; scale: number[]; clip: number };

const scaler = mouseScalerJson as ScalerData;
// Matching scaler for the big/combined-dataset encoder (`embedBig` in
// encoder.ts) - fitted on that model's own training data, so it must not be
// mixed with the default `scaler` above.
const scalerBig = mouseScalerBigJson as ScalerData;

function runScaler(s: ScalerData, features: number[]): number[] {
  return features.map((v, i) => {
    const z = (signedLog1p(v) - s.mean[i]) / s.scale[i];
    return clip(z, -s.clip, s.clip);
  });
}

export function scaleFeatures(features: number[]): number[] {
  return runScaler(scaler, features);
}

export function scaleFeaturesBig(features: number[]): number[] {
  return runScaler(scalerBig, features);
}
