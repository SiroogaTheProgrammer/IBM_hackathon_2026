import type { NextConfig } from "next";

// The behavioral-biometrics engine now runs natively in this site's own
// Next.js Route Handlers (src/app/api/biometrics/*) instead of proxying to a
// separately-hosted Python process - see src/lib/biometrics/ for the ported
// encoder/scaler/risk-model/tab-nav/keystroke/composite logic. Session state
// (gallery, fitted risk model, streak/escalation) is persisted in Upstash
// Redis between requests since serverless functions are stateless. No
// rewrite/proxy is needed: Next's filesystem routes already serve these
// paths directly.
const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // @tensorflow/tfjs-node loads a native .node addon at runtime and resolves
  // it by path, which the bundler cannot follow. Marking it external makes the
  // route handlers `require` it from node_modules instead. Only the autoencoder
  // (src/lib/biometrics/autoencoder/) touches it, and it degrades to the pure-JS
  // backend where the native binary is unavailable - so a host that cannot ship
  // native addons still works, just slower.
  serverExternalPackages: ["@tensorflow/tfjs-node"],
};

export default nextConfig;
