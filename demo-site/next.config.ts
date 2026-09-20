import path from "node:path";
import type { NextConfig } from "next";

/**
 * The stroke encoder's feature extraction lives in `big-boy-ts/src/shared`, and
 * it has to be *that* code rather than a copy: the whole point of the package is
 * that the features the browser computes at test time and the features the
 * trainer computed at training time come from one compiled source
 * (`big-boy-ts/README.md`, and description.md §3.2). So the demo imports across
 * the repo instead of vendoring.
 *
 * Turbopack needs two things for that: a `root` that contains both packages, so
 * a path outside `demo-site/` is resolvable at all, and an explicit alias,
 * because it does not read `tsconfig.json` paths that escape the project.
 */
const repoRoot = path.join(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@encoder": path.join(repoRoot, "big-boy-ts", "src", "shared"),
    },
  },
};

export default nextConfig;
