/**
 * Loader for the Balabit-style CSV dataset in training_files/ and test_files/.
 * Used by the offline training and benchmark scripts - not by the request path.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { concatWindows, eventsToWindowFeatures, parseSessionCsv } from "./features";

/**
 * Featurise every session in a user's directory.
 *
 * Each session is windowed independently: session CSVs each restart their
 * clock at 0, so windowing a concatenation of them would straddle the seams.
 */
export async function loadUserWindows(
  userDir: string,
  windowSeconds?: number,
): Promise<{ data: Float32Array; rows: number }> {
  const names = (await readdir(userDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  const blocks = [];
  for (const name of names) {
    const events = parseSessionCsv(await readFile(join(userDir, name), "utf8"));
    blocks.push(eventsToWindowFeatures(events, windowSeconds));
  }
  return concatWindows(blocks);
}

export async function listUsers(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}
