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
import { SubtaskRecorder, readViewport } from "@/lib/trace/capture";
import type { Viewport } from "@/lib/trace/capture";
import { loadEncoder } from "@/lib/trace/encoder";
import type { BackendConfig, LoadedEncoder } from "@/lib/trace/encoder";
import type { RunEmbeddings } from "@/lib/trace/score";
import {
  MIN_SCORED_FOR_INDICATOR,
  decide,
  scoreSubtask,
  thresholdsFor,
  trustScore,
} from "@/lib/trace/score";
import type {
  Enrollment,
  SubtaskScore,
  Thresholds,
  Verdict,
} from "@/lib/trace/score";
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
import {
  FLOW_LENGTH,
  FLOW_START_ROUTE,
  MIN_TYPED_CHARS,
  flowSubtasks,
  locate,
} from "@/data/taskFlow";
import type { Subtask } from "@/data/taskFlow";

/**
 * The run engine. It lives in the `(site)` layout, so it survives every in-app
 * navigation the flow makes — a run is one continuous recording from "Start" to
 * the last sub-task, not one per page.
 *
 * Responsibilities, and nothing else:
 *   - drive the fixed flow (`@/data/taskFlow`) one sub-task at a time,
 *   - record the raw pointer stream of the sub-task in progress,
 *   - hand it to the shared pipeline: segment → features → encoder → one
 *     128-d embedding per sub-task (§3.4, §4, §5.1),
 *   - on enrollment, keep that embedding as the template for its sub-task id,
 *   - on a test run, score it through the §6 backend and stop the run on a
 *     lockout.
 *
 * **Inference never blocks the participant.** The flow advances the moment a
 * sub-task's terminating interaction fires; segmentation and the forward pass
 * happen on a serial queue behind it. A lockout can therefore land a beat after
 * the sub-task that caused it, which is both unavoidable and true to §2.2's
 * "within 20–40 s of the handover".
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

export type EncoderStatus = "idle" | "loading" | "ready" | "failed";

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
  encoderStatus: EncoderStatus;
  encoderError: string;
  /** The shipped §6 parameters, once loaded. `null` means "no decision". */
  backend: BackendConfig | null;
  /** Geometry of the run in progress, or of the last one (§3.3). */
  runViewport: Viewport | null;
  /** Sub-tasks whose embedding is still being computed. */
  pending: number;
};

export type TraceApi = TraceState & {
  current: Subtask | null;
  position: ReturnType<typeof locate>;
  /** The participant is not on the route this sub-task lives on. */
  offTrack: boolean;
  /** SPRT boundaries in force for this run, widened on a viewport mismatch. */
  thresholds: Thresholds | null;
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
  encoderStatus: "idle",
  encoderError: "",
  backend: null,
  runViewport: null,
  pending: 0,
};

const subscribeNothing = () => () => {};

export default function TraceProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const [state, setState] = useState<TraceState>(INITIAL);

  /** Raw pointer stream of the sub-task in progress. */
  const recorder = useRef<SubtaskRecorder | null>(null);
  /** Geometry the run in progress is being captured under. */
  const viewport = useRef<Viewport | null>(null);
  /** Pointer hardware last seen, carried into the run's viewport metadata. */
  const pointerType = useRef("unknown");
  /** Last pointer position, used as the landing point for typed sub-tasks. */
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  /** Embeddings produced so far by the run in progress. */
  const embeddings = useRef<RunEmbeddings>({});
  /** Raw SapiMouse-shaped log, live only during a collection run. */
  const logger = useRef<SessionLogger | null>(null);
  /** Identifies the save in flight, so a late response cannot clobber a newer one. */
  const saveId = useRef(0);

  /**
   * Serial queue for the encoder. One forward pass per sub-task, in flow order,
   * so the accumulator sees the sub-tasks in the order they happened.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Discriminates jobs of the current run from stragglers of an aborted one. */
  const runId = useRef(0);

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
   * Mirrors `state` for the DOM listeners and the queued jobs, which are
   * registered once and must not be rebuilt on every sub-task. Every writer
   * below updates it in the same breath as `setState`.
   */
  const live = useRef(state);

  /** Whether the run has reached the start route and sub-task 1.1 is live. */
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
    recorder.current = new SubtaskRecorder(subtask.id, performance.now());
  }, []);

  const enqueue = useCallback(
    (job: () => Promise<void>) => {
      queue.current = queue.current.then(job).catch((error: unknown) => {
        commit({
          ...live.current,
          encoderStatus: "failed",
          encoderError:
            error instanceof Error ? error.message : "encoder failed",
        });
      });
    },
    [commit],
  );

  /* ------------------------------------------------------------- start --- */

  const start = useCallback(
    (phase: "training" | "testing" | "collecting") => {
      recorder.current = null;
      embeddings.current = {};
      armed.current = false;
      runId.current += 1;

      logger.current?.stop();
      logger.current = null;

      const runViewport = readViewport(pointerType.current);
      viewport.current = runViewport;

      if (phase === "collecting") {
        /*
         * The logger reads the flow position per sample instead of being told
         * when it changes, so it can start before the run is even armed. This
         * path deliberately never touches the encoder: a collection run is raw
         * data capture and nothing else.
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

      const needsEncoder = phase !== "collecting";

      commit({
        ...live.current,
        phase,
        index: 0,
        scores: [],
        verdict: "running",
        runViewport,
        pending: 0,
        encoderStatus: needsEncoder
          ? live.current.encoderStatus === "ready"
            ? "ready"
            : "loading"
          : live.current.encoderStatus,
        encoderError: "",
      });

      if (needsEncoder) {
        // Kick the download off now so the first sub-task is not also the first
        // 660 KB of model weights.
        loadEncoder().then(
          (loaded) => {
            commit({
              ...live.current,
              encoderStatus: "ready",
              backend: loaded.backend,
            });
          },
          (error: unknown) => {
            commit({
              ...live.current,
              encoderStatus: "failed",
              encoderError:
                error instanceof Error
                  ? error.message
                  : "encoder failed to load",
            });
          },
        );
      }

      router.push(FLOW_START_ROUTE);
    },
    [commit, router],
  );

  const startTraining = useCallback(() => start("training"), [start]);
  const startTest = useCallback(() => start("testing"), [start]);
  const startCollection = useCallback(() => start("collecting"), [start]);

  const abort = useCallback(() => {
    recorder.current = null;
    embeddings.current = {};
    armed.current = false;
    runId.current += 1;

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
      encoderStatus: previous.encoderStatus,
      backend: previous.backend,
    });
  }, [commit]);

  const setCollectionMode = useCallback(
    (on: boolean) => {
      if (on && !isLocalhost()) return;
      logger.current?.stop();
      logger.current = null;
      recorder.current = null;
      embeddings.current = {};
      armed.current = false;
      runId.current += 1;
      commit({
        ...INITIAL,
        enrollment: live.current.enrollment,
        phase: !on && live.current.enrollment ? "enrolled" : "idle",
        collectionMode: on,
        lastSave: live.current.lastSave,
        encoderStatus: live.current.encoderStatus,
        backend: live.current.backend,
      });
    },
    [commit],
  );

  /* -------------------------------------------------------- saving runs --- */

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

  /** Turn one finished sub-task into its embedding, then file it or score it. */
  const processSubtask = useCallback(
    async (
      subtaskId: string,
      finished: SubtaskRecorder,
      runViewport: Viewport,
      job: number,
    ): Promise<void> => {
      if (job !== runId.current) return;

      const loaded: LoadedEncoder = await loadEncoder();
      const strokes = finished.strokes(runViewport);
      // §6.1: fewer than two strokes is skipped, not scored noisily.
      const embedding = await loaded.encoder.encodeSubtask(
        strokes.map((entry) => entry.features),
      );

      if (job !== runId.current) return;
      const snapshot = live.current;
      const pending = Math.max(0, snapshot.pending - 1);

      if (embedding) embeddings.current[subtaskId] = embedding;

      if (snapshot.phase === "training") {
        commit({ ...snapshot, pending });
        return;
      }

      if (snapshot.phase !== "testing") return;

      const { enrollment, backend } = snapshot;

      // No fitted backend means no decision — the embeddings are still real,
      // there is simply nothing calibrated to turn them into a verdict.
      if (!enrollment || !backend) {
        commit({ ...snapshot, pending });
        return;
      }

      const thresholds = thresholdsFor(
        backend,
        enrollment.viewport,
        runViewport,
      );
      const previousEvidence =
        snapshot.scores[snapshot.scores.length - 1]?.evidence ?? 0;
      const score = scoreSubtask(
        subtaskId,
        embedding,
        enrollment,
        previousEvidence,
        backend,
        loaded.cohort,
      );
      const scores = score ? [...snapshot.scores, score] : snapshot.scores;

      /*
       * Without thresholds there is no decision to make. The comparisons are
       * still real and still accumulate on screen — §6.3's boundaries are the
       * only missing piece, and they need §6.4's genuine distribution.
       */
      if (!thresholds) {
        commit({ ...snapshot, scores, pending });
        return;
      }

      const verdict = decide(scores, false, thresholds, snapshot.verdict);

      /* Only a lockout ends the run early; a verified run plays out (§2.2). */
      if (verdict === "locked") {
        runId.current += 1;
        recorder.current = null;
        commit({ ...snapshot, phase: "finished", scores, verdict, pending: 0 });
        return;
      }

      commit({ ...snapshot, scores, verdict, pending });
    },
    [commit],
  );

  /**
   * Close the sub-task in progress and move on.
   *
   * The state change is synchronous; the encoder work is queued. The
   * participant is never waiting on a forward pass.
   */
  const advance = useCallback(() => {
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

    const finished = recorder.current;
    const runViewport = viewport.current ?? readViewport(pointerType.current);
    const job = runId.current;

    if (flowComplete) recorder.current = null;
    else beginSubtask(nextIndex);

    commit({
      ...snapshot,
      index: flowComplete ? FLOW_LENGTH : nextIndex,
      pending: snapshot.pending + (finished ? 1 : 0),
    });

    if (finished) {
      enqueue(() => processSubtask(subtask.id, finished, runViewport, job));
    }

    if (flowComplete) {
      // Queued after every per-sub-task job, so the enrollment is only sealed
      // once every embedding that is going to arrive has arrived.
      enqueue(async () => {
        if (job !== runId.current) return;
        const snap = live.current;

        if (snap.phase === "training") {
          const captured = { ...embeddings.current };
          commit({
            ...snap,
            phase: "enrolled",
            pending: 0,
            enrollment: {
              capturedAt: Date.now(),
              embeddings: captured,
              covered: Object.keys(captured).length,
              viewport: runViewport,
            },
          });
          return;
        }

        if (snap.phase === "testing") {
          const thresholds =
            snap.enrollment && snap.backend
              ? thresholdsFor(
                  snap.backend,
                  snap.enrollment.viewport,
                  runViewport,
                )
              : null;
          commit({
            ...snap,
            phase: "finished",
            pending: 0,
            verdict: thresholds
              ? decide(snap.scores, true, thresholds, snap.verdict)
              : "inconclusive",
          });
        }
      });
    }
  }, [beginSubtask, commit, enqueue, processSubtask, writeRun]);

  /* ---------------------------------------------------------- listeners --- */

  useEffect(() => {
    if (!running) return;

    const overUi = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest(`[${UI_ATTRIBUTE}]`) !== null;

    const onPointerMove = (event: PointerEvent) => {
      if (overUi(event.target)) return;
      if (event.pointerType) pointerType.current = event.pointerType;
      lastPoint.current = { x: event.clientX, y: event.clientY };
      recorder.current?.addMove(event);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (overUi(event.target)) return;
      recorder.current?.addDown(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (overUi(event.target)) return;
      recorder.current?.addUp(event);
    };

    /** Does this element end the sub-task — as its target, or as an alias? */
    const terminates = (
      subtask: Subtask,
      value: string | undefined,
    ): boolean =>
      value !== undefined &&
      (value === subtask.target || (subtask.alsoAccepts?.includes(value) ?? false));

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
      if (!hit || !terminates(subtask, hit.dataset.trace)) return;

      advance();
    };

    /**
     * A text sub-task ends once the field holds a couple of characters. The
     * string itself is not checked — only that the participant reached the
     * right field and actually started typing in it.
     */
    const onTypeInField = (event: Event) => {
      if (!armed.current) return;

      const subtask = flowSubtasks[live.current.index];
      if (!subtask || subtask.kind !== "type") return;

      const field = event.target;
      if (
        !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      if (!terminates(subtask, field.dataset.trace)) return;
      if (field.value.trim().length < MIN_TYPED_CHARS) return;

      advance();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onTypeInField, true);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onTypeInField, true);
    };
  }, [running, advance]);

  /* --------------------------------------------------------------- api --- */

  const api = useMemo<TraceApi>(() => {
    const current = flowSubtasks[state.index] ?? null;

    const thresholds =
      state.backend && state.enrollment && state.runViewport
        ? thresholdsFor(
            state.backend,
            state.enrollment.viewport,
            state.runViewport,
          )
        : null;

    const evidence =
      state.scores.length >= MIN_SCORED_FOR_INDICATOR ||
      state.phase === "finished"
        ? (state.scores[state.scores.length - 1]?.evidence ?? 0)
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
      thresholds,
      evidence,
      trust:
        evidence === null || !thresholds
          ? null
          : trustScore(evidence, thresholds),
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
