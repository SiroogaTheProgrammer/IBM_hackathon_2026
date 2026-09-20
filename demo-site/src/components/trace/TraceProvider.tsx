"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { SubtaskRecorder, extractFeatures } from "@/lib/trace/capture";
import {
  SessionLogger,
  advanceParticipant,
  downloadCsv,
  getParticipant,
  getParticipantServerSnapshot,
  isLocalhost,
  pendingRun,
  postRun,
  subscribeParticipant,
} from "@/lib/trace/collect";
import type { SavedRun } from "@/lib/trace/collect";
import type { RunVectors } from "@/lib/trace/score";
import {
  MIN_SCORED_FOR_INDICATOR,
  decide,
  scoreSubtask,
  trustScore,
} from "@/lib/trace/score";
import type { Enrollment, SubtaskScore, Verdict } from "@/lib/trace/score";
import {
  FLOW_LENGTH,
  FLOW_START_ROUTE,
  flowSubtasks,
  locate,
} from "@/data/taskFlow";
import type { Subtask } from "@/data/taskFlow";

/**
 * The run engine. It lives in the root layout, so it survives every in-app
 * navigation the flow makes — a run is one continuous recording from "Start"
 * to the last sub-task, not one per page.
 *
 * Responsibilities, and nothing else:
 *   - drive the fixed flow (`@/data/taskFlow`) one sub-task at a time,
 *   - record the trajectory of the sub-task in progress (`@/lib/trace/capture`),
 *   - on enrollment, keep each sub-task's vector as that user's template,
 *   - on a test run, score each sub-task and stop the run on a lockout
 *     (`@/lib/trace/score`).
 *
 * Everything is in memory: a reload clears the enrollment, which is the right
 * default for a study kiosk and means no trajectory is ever persisted.
 */

export type Phase =
  /** Nothing enrolled yet. */
  | "idle"
  /** Enrollment run in progress. */
  | "training"
  /** A template exists; ready for a test run. */
  | "enrolled"
  /** Test run in progress. */
  | "testing"
  /** Test run over — see `verdict`. */
  | "finished"
  /** Data-collection run in progress (localhost only). */
  | "collecting"
  /** Data-collection run written to disk — see `lastSave`. */
  | "collected";

export type TraceState = {
  phase: Phase;
  /** Index into `flowSubtasks`, or `FLOW_LENGTH` once the flow is done. */
  index: number;
  enrollment: Enrollment | null;
  scores: SubtaskScore[];
  verdict: Verdict;
  /** Collection mode replaces enrol/test with "record a run and save it". */
  collectionMode: boolean;
  /** The file the last collection run produced. */
  lastSave: SavedRun | null;
};

export type TraceApi = TraceState & {
  current: Subtask | null;
  position: ReturnType<typeof locate>;
  /** The participant is not on the route this sub-task lives on. */
  offTrack: boolean;
  /** Accumulated evidence, withheld until enough sub-tasks have scored (§2.2). */
  evidence: number | null;
  trust: number | null;
  startTraining: () => void;
  startTest: () => void;
  abort: () => void;
  /** Whether the collection toggle should be offered at all. */
  collectionAvailable: boolean;
  setCollectionMode: (on: boolean) => void;
  startCollection: () => void;
  /** Retry the server write for the last recorded run. */
  saveAgain: () => void;
  /** Fall back to a browser download when the server cannot be reached. */
  downloadLastRun: () => void;
  /** The `n` the next run will be saved as. */
  participant: number;
};

const TraceContext = createContext<TraceApi | null>(null);

export function useTrace(): TraceApi {
  const value = useContext(TraceContext);
  if (!value) throw new Error("useTrace must be used inside <TraceProvider>");
  return value;
}

/** Pointer activity over the Trace card itself is not part of any sub-task. */
const UI_ATTRIBUTE = "data-trace-ui";

const INITIAL: TraceState = {
  phase: "idle",
  index: 0,
  enrollment: null,
  scores: [],
  verdict: "running",
  collectionMode: false,
  lastSave: null,
};

const subscribeNothing = () => () => {};

export default function TraceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const [state, setState] = useState<TraceState>(INITIAL);

  /** Trajectory of the sub-task in progress. */
  const recorder = useRef<SubtaskRecorder | null>(null);
  /** When the current sub-task became current. */
  const subtaskStart = useRef<number>(0);
  /** Last pointer position, used as the landing point for typed sub-tasks. */
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  /** Vectors captured so far by the run in progress. */
  const vectors = useRef<RunVectors>({});
  /** Raw SapiMouse-shaped log, live only during a collection run. */
  const logger = useRef<SessionLogger | null>(null);
  /** Identifies the save in flight, so a late response cannot clobber a newer one. */
  const saveId = useRef(0);

  const collectionAvailable = useSyncExternalStore(
    subscribeNothing,
    isLocalhost,
    () => false,
  );
  const participant = useSyncExternalStore(
    subscribeParticipant,
    getParticipant,
    getParticipantServerSnapshot,
  );

  /**
   * Mirrors `state` for the DOM listeners, which are registered once and must
   * not be torn down and rebuilt on every sub-task. Every writer below updates
   * it in the same breath as `setState`, so a click can never read a snapshot
   * that is one sub-task behind.
   */
  const live = useRef(state);

  /**
   * Whether the run has reached the start route and sub-task 1.1 is live. A
   * ref rather than state: only the listeners read it, and re-rendering on it
   * would buy nothing.
   */
  const armed = useRef(false);

  /** The one place run state changes, so the mirror can never drift. */
  const commit = useCallback((next: TraceState) => {
    live.current = next;
    setState(next);
  }, []);

  const running =
    state.phase === "training" ||
    state.phase === "testing" ||
    state.phase === "collecting";

  const beginSubtask = useCallback((index: number) => {
    const subtask = flowSubtasks[index];
    if (!subtask) return;
    subtaskStart.current = performance.now();
    recorder.current = new SubtaskRecorder(subtask.id, subtaskStart.current);
  }, []);

  /* ------------------------------------------------------------- start --- */

  const start = useCallback(
    (phase: "training" | "testing" | "collecting") => {
      recorder.current = null;
      vectors.current = {};
      armed.current = false;

      logger.current?.stop();
      logger.current = null;

      if (phase === "collecting") {
        /*
         * The logger reads the flow position per sample instead of being told
         * when it changes, so it can start before the run is even armed.
         */
        const session = new SessionLogger(() => {
          const here = locate(live.current.index);
          return {
            task: here?.task.id ?? "",
            subtask: here?.subtask.id ?? "",
          };
        });
        session.start();
        logger.current = session;
      }

      commit({
        ...live.current,
        phase,
        index: 0,
        scores: [],
        verdict: "running",
      });
      router.push(FLOW_START_ROUTE);
    },
    [commit, router],
  );

  const startTraining = useCallback(() => start("training"), [start]);
  const startTest = useCallback(() => start("testing"), [start]);
  const startCollection = useCallback(() => start("collecting"), [start]);

  const abort = useCallback(() => {
    recorder.current = null;
    vectors.current = {};
    armed.current = false;

    /* An abandoned collection run is discarded, not written out. */
    logger.current?.stop();
    logger.current = null;

    const previous = live.current;
    commit({
      ...INITIAL,
      phase: previous.collectionMode
        ? "idle"
        : previous.enrollment
          ? "enrolled"
          : "idle",
      enrollment: previous.enrollment,
      collectionMode: previous.collectionMode,
      lastSave: previous.lastSave,
    });
  }, [commit]);

  /**
   * Fire the write and fold the outcome back into state. Guarded by `saveId`
   * because the participant can start the next run before this settles.
   */
  const writeRun = useCallback(
    (run: SavedRun) => {
      postRun(run.participant, run.csv).then(
        (writtenTo) => {
          if (live.current.lastSave?.id !== run.id) return;
          commit({
            ...live.current,
            lastSave: { ...run, status: "saved", path: writtenTo },
          });
          advanceParticipant();
        },
        (error: unknown) => {
          if (live.current.lastSave?.id !== run.id) return;
          commit({
            ...live.current,
            lastSave: {
              ...run,
              status: "failed",
              error: error instanceof Error ? error.message : "Write failed",
            },
          });
        },
      );
    },
    [commit],
  );

  const saveAgain = useCallback(() => {
    const previous = live.current.lastSave;
    if (!previous) return;

    const run: SavedRun = {
      ...previous,
      id: (saveId.current += 1),
      status: "saving",
      error: "",
    };
    commit({ ...live.current, lastSave: run });
    writeRun(run);
  }, [commit, writeRun]);

  const downloadLastRun = useCallback(() => {
    const saved = live.current.lastSave;
    if (saved) downloadCsv(`user-${saved.participant}.csv`, saved.csv);
  }, []);

  const setCollectionMode = useCallback(
    (on: boolean) => {
      if (on && !isLocalhost()) return;
      logger.current?.stop();
      logger.current = null;
      recorder.current = null;
      vectors.current = {};
      armed.current = false;
      commit({
        ...INITIAL,
        enrollment: live.current.enrollment,
        phase: !on && live.current.enrollment ? "enrolled" : "idle",
        collectionMode: on,
        lastSave: live.current.lastSave,
      });
    },
    [commit],
  );

  /**
   * A run only starts counting once the browser is actually on the start
   * route, so the router's own latency never lands inside sub-task 1.1.
   */
  useEffect(() => {
    if (!running || armed.current) return;
    if (pathname !== FLOW_START_ROUTE) return;

    armed.current = true;
    beginSubtask(0);
  }, [running, pathname, beginSubtask]);

  /* ---------------------------------------------------------- advancing --- */

  /**
   * Close the sub-task in progress: turn its trajectory into a feature vector,
   * file it (enrollment) or score it (test run), then move on — or finish.
   */
  const advance = useCallback(
    (endPoint: { x: number; y: number } | null, targetRect: DOMRect | null) => {
      const snapshot = live.current;
      const subtask = flowSubtasks[snapshot.index];
      if (!subtask) return;

      const nextIndex = snapshot.index + 1;
      const flowComplete = nextIndex >= FLOW_LENGTH;

      /*
       * A collection run scores nothing and enrols nothing — it only walks the
       * flow so the raw log is segmented by sub-task, then writes the file.
       */
      if (snapshot.phase === "collecting") {
        if (!flowComplete) {
          commit({ ...snapshot, index: nextIndex });
          return;
        }

        const session = logger.current;
        logger.current = null;
        session?.stop();

        const run = session
          ? pendingRun(session, getParticipant(), (saveId.current += 1))
          : null;

        commit({
          ...snapshot,
          phase: "collected",
          index: FLOW_LENGTH,
          lastSave: run,
        });

        if (run) writeRun(run);
        return;
      }

      const endedAt = performance.now();
      const active = recorder.current;

      const vector = active
        ? extractFeatures({
            samples: active.trajectory(),
            startedAt: subtaskStart.current,
            endedAt,
            endPoint,
            targetRect,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          })
        : null;

      if (vector) vectors.current[subtask.id] = vector;

      if (snapshot.phase === "training") {
        if (!flowComplete) {
          beginSubtask(nextIndex);
          commit({ ...snapshot, index: nextIndex });
          return;
        }

        const captured = { ...vectors.current };
        recorder.current = null;
        commit({
          ...snapshot,
          phase: "enrolled",
          index: FLOW_LENGTH,
          enrollment: {
            capturedAt: Date.now(),
            vectors: captured,
            covered: Object.keys(captured).length,
          },
        });
        return;
      }

      /* test run */
      const enrollment = snapshot.enrollment;
      if (!enrollment) return;

      const previousEvidence =
        snapshot.scores[snapshot.scores.length - 1]?.evidence ?? 0;
      const score = scoreSubtask(
        subtask.id,
        vector,
        enrollment,
        previousEvidence,
      );
      const scores = score ? [...snapshot.scores, score] : snapshot.scores;
      const verdict = decide(scores, flowComplete, snapshot.verdict);

      /* Only a lockout ends the run early; a verified run plays out (§2.2). */
      if (verdict !== "locked" && !flowComplete) {
        beginSubtask(nextIndex);
        commit({ ...snapshot, index: nextIndex, scores, verdict });
        return;
      }

      recorder.current = null;
      commit({
        ...snapshot,
        phase: "finished",
        index: flowComplete ? FLOW_LENGTH : nextIndex,
        scores,
        verdict,
      });
    },
    [beginSubtask, commit, writeRun],
  );

  /* ---------------------------------------------------------- listeners --- */

  useEffect(() => {
    if (!running) return;

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[${UI_ATTRIBUTE}]`)) {
        return;
      }
      lastPoint.current = { x: event.clientX, y: event.clientY };
      recorder.current?.add(event);
    };

    /**
     * Capture phase, so the sub-task is closed before `next/link` unmounts the
     * element that was clicked.
     */
    const onClick = (event: MouseEvent) => {
      if (!armed.current) return;

      const subtask = flowSubtasks[live.current.index];
      if (!subtask || subtask.kind !== "click") return;
      if (!(event.target instanceof Element)) return;

      const hit = event.target.closest<HTMLElement>("[data-trace]");
      if (!hit || hit.dataset.trace !== subtask.target) return;

      advance(
        { x: event.clientX, y: event.clientY },
        hit.getBoundingClientRect(),
      );
    };

    const onInput = (event: Event) => {
      if (!armed.current) return;

      const subtask = flowSubtasks[live.current.index];
      if (!subtask || subtask.kind !== "type" || !subtask.expect) return;
      if (!(event.target instanceof HTMLInputElement)) return;

      const field = event.target;
      if (field.dataset.trace !== subtask.target) return;
      if (!field.value.trim().toLowerCase().includes(subtask.expect)) return;

      advance(lastPoint.current, field.getBoundingClientRect());
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
    };
  }, [running, advance]);

  /* --------------------------------------------------------------- api --- */

  const api = useMemo<TraceApi>(() => {
    const current = flowSubtasks[state.index] ?? null;

    const evidence =
      state.scores.length >= MIN_SCORED_FOR_INDICATOR ||
      state.phase === "finished"
        ? state.scores[state.scores.length - 1]?.evidence ?? 0
        : null;

    const isRunning =
      state.phase === "training" ||
      state.phase === "testing" ||
      state.phase === "collecting";

    return {
      ...state,
      current,
      position: locate(state.index),
      /*
       * Sub-task 1.1 is exempt: while the router is still on its way to the
       * start route the pathname is legitimately the wrong one.
       */
      offTrack:
        isRunning && state.index > 0 && current
          ? pathname !== current.route
          : false,
      evidence,
      trust: evidence === null ? null : trustScore(evidence),
      startTraining,
      startTest,
      abort,
      collectionAvailable,
      setCollectionMode,
      startCollection,
      saveAgain,
      downloadLastRun,
      participant,
    };
  }, [
    state,
    pathname,
    startTraining,
    startTest,
    abort,
    collectionAvailable,
    setCollectionMode,
    startCollection,
    saveAgain,
    downloadLastRun,
    participant,
  ]);

  return <TraceContext.Provider value={api}>{children}</TraceContext.Provider>;
}
