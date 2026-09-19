/**
 * A one-file pub/sub between the three client components that have to agree
 * on where a session is: `QuizBody` knows when an attempt was submitted,
 * `BiometricsWidget` knows when the model stops warming up, and `TaskPanel`
 * is the only one that cares about either.
 *
 * A React context would mean wrapping the whole `(site)` tree — including the
 * server-rendered pages — in another provider just to move two events; a
 * module-level listener set costs nothing and keeps the pages untouched.
 * Both ends live in the same client bundle, so this module is a singleton.
 */

export type TaskSignal =
  /** A quiz attempt was submitted from `/mod/quiz/<activityId>`. */
  | { kind: "quiz-submitted"; activityId: string }
  /** One biometrics tick came back: is the model still enrolling? */
  | { kind: "bio-status"; warming: boolean; gallerySize: number; warmupSize: number }
  /** Warm-up was cleared (the widget's Reset or Quit), so the run restarts. */
  | { kind: "bio-reset" };

type Listener = (signal: TaskSignal) => void;

const listeners = new Set<Listener>();

export function emitTaskSignal(signal: TaskSignal): void {
  // Copy first: a listener that unsubscribes itself would otherwise mutate
  // the set mid-iteration.
  for (const listener of [...listeners]) listener(signal);
}

/** Subscribe; returns the unsubscribe function an effect can return directly. */
export function onTaskSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
