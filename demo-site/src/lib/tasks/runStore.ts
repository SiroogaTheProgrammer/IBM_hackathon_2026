/**
 * The scripted run's state, held outside React.
 *
 * `TaskPanel` renders it through `useSyncExternalStore`, which is what makes
 * the two awkward parts of this state work: it lives in `localStorage` (so a
 * reload mid-run resumes rather than restarting, with `getServerSnapshot`
 * returning `null` so the server never paints a run it cannot know about),
 * and it advances from events that arrive outside React — a submitted quiz
 * attempt, a biometrics tick — rather than from user input on the panel.
 *
 * See `@/data/tasks` for the script itself and `./signals` for the events.
 */

import { taskRuns, type TaskPhase } from "@/data/tasks";
import { onTaskSignal, type TaskSignal } from "./signals";

const PROGRESS_KEY = "mc_task_run";
const COLLAPSE_KEY = "mc_task_collapsed";

export type TaskRunState = {
  phase: TaskPhase;
  /** Tasks completed in each run — also the index of its current task. */
  training: number;
  testing: number;
  collapsed: boolean;
  /** Enrolment progress as last reported by a biometrics tick. */
  warmup: { done: number; total: number } | null;
  /** The selected engine has finished enrolling, so scoring is live. */
  modelReady: boolean;
};

const FRESH_PROGRESS = { phase: "training" as TaskPhase, training: 0, testing: 0 };

let state: TaskRunState = {
  ...FRESH_PROGRESS,
  collapsed: false,
  warmup: null,
  modelReady: false,
};
let hydrated = false;

const listeners = new Set<() => void>();
let unsubscribeSignals: (() => void) | null = null;

/* ------------------------------------------------------------ storage --- */

function clampToRun(value: unknown, run: TaskPhase): number {
  return Math.min(Math.max(Number(value) || 0, 0), taskRuns[run].tasks.length);
}

function readStored(): Partial<TaskRunState> {
  try {
    const collapsed = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { collapsed };
    const saved = JSON.parse(raw) as Partial<TaskRunState>;
    return {
      collapsed,
      phase: saved.phase === "testing" ? "testing" : "training",
      training: clampToRun(saved.training, "training"),
      testing: clampToRun(saved.testing, "testing"),
    };
  } catch {
    // Private mode, a wiped quota or hand-edited JSON: start the run over
    // rather than failing the render.
    return {};
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        phase: state.phase,
        training: state.training,
        testing: state.testing,
      }),
    );
    window.localStorage.setItem(COLLAPSE_KEY, state.collapsed ? "1" : "0");
  } catch {
    // Progress is a convenience, not the demo: a failed write is survivable.
  }
}

/* -------------------------------------------------------------- store --- */

function update(patch: Partial<TaskRunState>): void {
  const next = { ...state, ...patch };
  // `getSnapshot` has to be referentially stable between real changes, or
  // `useSyncExternalStore` re-renders on every tick that reports the same
  // warm-up count.
  if (
    next.phase === state.phase &&
    next.training === state.training &&
    next.testing === state.testing &&
    next.collapsed === state.collapsed &&
    next.modelReady === state.modelReady &&
    next.warmup?.done === state.warmup?.done &&
    next.warmup?.total === state.warmup?.total
  ) {
    return;
  }
  state = next;
  persist();
  for (const listener of [...listeners]) listener();
}

/** The task the participant is on, or `undefined` once the run is finished. */
function currentTask() {
  const run = taskRuns[state.phase];
  return run.tasks[state[state.phase]];
}

/**
 * Hand over to the test pass only when both halves agree it is time: every
 * training task done *and* the model finished enrolling. Either condition
 * alone would cut the other short — a script the model never saw, or a
 * scored pass that is still being trained on.
 */
function advanceIfReady(): void {
  if (state.phase !== "training") return;
  if (state.training < taskRuns.training.tasks.length) return;
  if (!state.modelReady) return;
  update({ phase: "testing" });
}

/** Tick off the current task, by id, so a stale check cannot skip ahead. */
function completeTask(taskId: string): void {
  const task = currentTask();
  if (task?.id !== taskId) return;
  update({ [state.phase]: state[state.phase] + 1 });
  advanceIfReady();
}

function handleSignal(signal: TaskSignal): void {
  switch (signal.kind) {
    case "bio-status":
      update({
        modelReady: !signal.warming,
        warmup: { done: signal.gallerySize, total: signal.warmupSize },
      });
      advanceIfReady();
      return;
    case "bio-reset":
      // Enrolment was wiped, so the scripted run starts over with it.
      update({ ...FRESH_PROGRESS, warmup: null, modelReady: false });
      return;
    case "quiz-submitted": {
      const task = currentTask();
      if (task?.check.kind === "quiz" && task.check.activityId === signal.activityId) {
        completeTask(task.id);
      }
    }
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribeSignals) unsubscribeSignals = onTaskSignal(handleSignal);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeSignals?.();
      unsubscribeSignals = null;
    }
  };
}

export function getSnapshot(): TaskRunState {
  if (!hydrated) {
    state = { ...state, ...readStored() };
    hydrated = true;
  }
  return state;
}

/** No run exists on the server, so the panel renders nothing until hydration. */
export function getServerSnapshot(): null {
  return null;
}

/* ------------------------------------------------------------ actions --- */

/** Called on every route change: route tasks complete by arriving. */
export function completeVisit(pathname: string): void {
  const task = currentTask();
  if (task?.check.kind === "visit" && task.check.path === pathname) {
    completeTask(task.id);
  }
}

export function setCollapsed(collapsed: boolean): void {
  update({ collapsed });
}

/**
 * Safety valve. Every check here is a guess about how a participant will get
 * somewhere, and a wrong guess must not strand them: skipping keeps the run
 * moving, and the rest of the script still lines both passes up.
 */
export function skipCurrentTask(): void {
  const task = currentTask();
  if (task) completeTask(task.id);
}

export function restartRun(): void {
  update({ ...FRESH_PROGRESS });
}

/** Demo escape hatch: start the scored pass without waiting for enrolment
 * (or at all, when the biometrics backend is unreachable). */
export function skipToTesting(): void {
  update({
    phase: "testing",
    training: taskRuns.training.tasks.length,
    testing: 0,
  });
}
