/**
 * TypeScript port of `FeatureScaler.transform` from
 * `behavioral_biometrics_nn/encoder.py`: signed-log1p, standardize with the
 * trained mean/scale, then clip. Parameters are exported once via
 * `export_web_model.py` into `model/mouseScaler.json`.
 */

import mouseScalerJson from "./model/mouseScaler.json";
import { clip, signedLog1p } from "./math";

type ScalerData = { mean: number[]; scale: number[]; clip: number };

const scaler = mouseScalerJson as ScalerData;

export function scaleFeatures(features: number[]): number[] {
  return features.map((v, i) => {
    const z = (signedLog1p(v) - scaler.mean[i]) / scaler.scale[i];
    return clip(z, -scaler.clip, scaler.clip);
  });
}
