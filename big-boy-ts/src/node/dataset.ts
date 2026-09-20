/**
 * Build the training matrix from SapiMouse, and cache it.
 *
 * Feature extraction is the slow part of the loop and it does not change
 * between training runs, so it is done once and written to `cache/`. The cache
 * is keyed by `FEATURE_VERSION`; editing `features.ts` invalidates it.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FEATURE_COUNT, FEATURE_VERSION } from "../shared/features.ts";
import { extractFromStrokes } from "../shared/pipeline.ts";
import { segmentStrokes } from "../shared/strokes.ts";
import { DEFAULT_AUGMENT, augmentStroke, makeRng } from "./augment.ts";
import { loadSapiMouse, type Session } from "./sapimouse.ts";

/**
 * Consecutive strokes are grouped into blocks that stand in for the demo's
 * sub-tasks (§2.1). SapiMouse has no task structure, so these blocks are *not*
 * aligned across users: the offline number is therefore a text-independent
 * lower bound on what the aligned demo flow achieves. Stated explicitly because
 * §7 warns against quoting a number the production setting does not match.
 */
export const BLOCK_STROKES = 6;

export type DatasetMeta = {
  featureVersion: string;
  featureCount: number;
  rows: number;
  subjects: string[];
  sessions: string[];
  augmentCopies: number;
  blockStrokes: number;
  builtAt: string;
};

export type Dataset = {
  meta: DatasetMeta;
  /** Row-major, `rows × FEATURE_COUNT`. */
  features: Float32Array;
  /** Per row: subject index. */
  subject: Int32Array;
  /** Per row: session index. */
  session: Int32Array;
  /** Per row: block index within its session (the pseudo sub-task). */
  block: Int32Array;
  /** Per row: 0 for a real stroke, 1..n for an augmented copy. */
  augment: Int32Array;
};

export type BuildOptions = {
  root: string;
  cacheDir: string;
  /** Augmented copies per real stroke (§5.4). 0 disables augmentation. */
  augmentCopies: number;
  seed: number;
  onProgress?: (done: number, total: number, note: string) => void;
};

function cachePaths(cacheDir: string): { features: string; labels: string; meta: string } {
  const base = join(cacheDir, `sapimouse.${FEATURE_VERSION}`);
  return {
    features: `${base}.features.f32`,
    labels: `${base}.labels.i32`,
    meta: `${base}.meta.json`,
  };
}

/** Extract every stroke of one session, plus its augmented copies. */
function extractSession(
  session: Session,
  augmentCopies: number,
  rng: () => number,
): { features: Float32Array; block: number; augment: number }[] {
  const strokes = segmentStrokes(session.events, session.diagonal);
  const out: { features: Float32Array; block: number; augment: number }[] = [];

  const base = extractFromStrokes(strokes, { diagonal: session.diagonal });
  base.forEach((item, index) => {
    out.push({
      features: item.features,
      block: Math.floor(index / BLOCK_STROKES),
      augment: 0,
    });
  });

  for (let copy = 1; copy <= augmentCopies; copy += 1) {
    const augmented = strokes.map((stroke) =>
      augmentStroke(stroke, session.diagonal, rng, DEFAULT_AUGMENT),
    );
    const rows = extractFromStrokes(augmented, { diagonal: session.diagonal });
    rows.forEach((item, index) => {
      out.push({
        features: item.features,
        block: Math.floor(index / BLOCK_STROKES),
        augment: copy,
      });
    });
  }

  return out;
}

/** Build the dataset from raw CSVs and write it to the cache. */
export function buildDataset(options: BuildOptions): Dataset {
  const sessions = loadSapiMouse(options.root);
  if (sessions.length === 0) {
    throw new Error(
      `no sessions found under ${options.root} — see README.md for the expected data/ layout`,
    );
  }

  const subjects: string[] = [];
  const subjectIndex = new Map<string, number>();
  const sessionNames: string[] = [];

  const featureChunks: Float32Array[] = [];
  const subjectIds: number[] = [];
  const sessionIds: number[] = [];
  const blockIds: number[] = [];
  const augmentIds: number[] = [];

  const rng = makeRng(options.seed);

  sessions.forEach((session, index) => {
    let subject = subjectIndex.get(session.subject);
    if (subject === undefined) {
      subject = subjects.length;
      subjects.push(session.subject);
      subjectIndex.set(session.subject, subject);
    }
    const sessionId = sessionNames.length;
    sessionNames.push(session.session);

    const rows = extractSession(session, options.augmentCopies, rng);
    for (const row of rows) {
      featureChunks.push(row.features);
      subjectIds.push(subject);
      sessionIds.push(sessionId);
      blockIds.push(row.block);
      augmentIds.push(row.augment);
    }

    options.onProgress?.(index + 1, sessions.length, `${session.session}: ${rows.length} rows`);
  });

  const rows = featureChunks.length;
  const features = new Float32Array(rows * FEATURE_COUNT);
  featureChunks.forEach((chunk, index) => features.set(chunk, index * FEATURE_COUNT));

  const dataset: Dataset = {
    meta: {
      featureVersion: FEATURE_VERSION,
      featureCount: FEATURE_COUNT,
      rows,
      subjects,
      sessions: sessionNames,
      augmentCopies: options.augmentCopies,
      blockStrokes: BLOCK_STROKES,
      builtAt: new Date().toISOString(),
    },
    features,
    subject: Int32Array.from(subjectIds),
    session: Int32Array.from(sessionIds),
    block: Int32Array.from(blockIds),
    augment: Int32Array.from(augmentIds),
  };

  writeDataset(dataset, options.cacheDir);
  return dataset;
}

export function writeDataset(dataset: Dataset, cacheDir: string): void {
  const paths = cachePaths(cacheDir);
  mkdirSync(dirname(paths.meta), { recursive: true });

  const labels = new Int32Array(dataset.meta.rows * 4);
  for (let i = 0; i < dataset.meta.rows; i += 1) {
    labels[i * 4] = dataset.subject[i]!;
    labels[i * 4 + 1] = dataset.session[i]!;
    labels[i * 4 + 2] = dataset.block[i]!;
    labels[i * 4 + 3] = dataset.augment[i]!;
  }

  writeFileSync(paths.features, Buffer.from(dataset.features.buffer));
  writeFileSync(paths.labels, Buffer.from(labels.buffer));
  writeFileSync(paths.meta, `${JSON.stringify(dataset.meta, null, 2)}\n`);
}

/** Load a previously built dataset, or `null` when the cache is absent/stale. */
export function readDataset(cacheDir: string): Dataset | null {
  const paths = cachePaths(cacheDir);
  let meta: DatasetMeta;
  try {
    meta = JSON.parse(readFileSync(paths.meta, "utf8")) as DatasetMeta;
  } catch {
    return null;
  }
  if (meta.featureVersion !== FEATURE_VERSION || meta.featureCount !== FEATURE_COUNT) {
    return null;
  }

  const featureBuffer = readFileSync(paths.features);
  const labelBuffer = readFileSync(paths.labels);

  const features = new Float32Array(
    featureBuffer.buffer.slice(
      featureBuffer.byteOffset,
      featureBuffer.byteOffset + featureBuffer.byteLength,
    ),
  );
  const labels = new Int32Array(
    labelBuffer.buffer.slice(
      labelBuffer.byteOffset,
      labelBuffer.byteOffset + labelBuffer.byteLength,
    ),
  );

  const subject = new Int32Array(meta.rows);
  const session = new Int32Array(meta.rows);
  const block = new Int32Array(meta.rows);
  const augment = new Int32Array(meta.rows);
  for (let i = 0; i < meta.rows; i += 1) {
    subject[i] = labels[i * 4]!;
    session[i] = labels[i * 4 + 1]!;
    block[i] = labels[i * 4 + 2]!;
    augment[i] = labels[i * 4 + 3]!;
  }

  return { meta, features, subject, session, block, augment };
}

/**
 * Identity-disjoint split (§5.5). No user appears in both halves, so the
 * verification numbers are not measuring memorised identities.
 */
export function splitSubjects(
  subjectCount: number,
  holdOut: number,
  seed: number,
): { train: Set<number>; eval: Set<number> } {
  const order = Array.from({ length: subjectCount }, (_, i) => i);
  const rng = makeRng(seed);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const held = new Set(order.slice(0, Math.min(holdOut, subjectCount)));
  const train = new Set(order.slice(Math.min(holdOut, subjectCount)));
  return { train, eval: held };
}

/** Row indices whose subject is in `subjects`. */
export function rowsForSubjects(dataset: Dataset, subjects: Set<number>): number[] {
  const rows: number[] = [];
  for (let i = 0; i < dataset.meta.rows; i += 1) {
    if (subjects.has(dataset.subject[i]!)) rows.push(i);
  }
  return rows;
}

/** Copy one row out of the packed matrix. */
export function featureRow(dataset: Dataset, index: number): Float32Array {
  const width = dataset.meta.featureCount;
  return dataset.features.slice(index * width, (index + 1) * width);
}
