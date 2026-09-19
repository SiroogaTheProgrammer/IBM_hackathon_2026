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
};

export default nextConfig;
