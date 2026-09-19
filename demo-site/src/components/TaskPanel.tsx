"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { taskRuns, type Task } from "@/data/tasks";
import {
  completeVisit,
  getServerSnapshot,
  getSnapshot,
  restartRun,
  setCollapsed,
  skipCurrentTask,
  skipToTesting,
  subscribe,
} from "@/lib/tasks/runStore";

/**
 * Top-left HUD: the scripted task list the participant works through, first
 * while the mouse model enrols (training) and then again while it scores them
 * (testing) — see `@/data/tasks` for why both passes follow one script.
 *
 * Mounted once in the `(site)` layout beside `BiometricsWidget`, so progress
 * survives client-side navigation. Tasks are strictly sequential: only the
 * current one can be ticked off, which is what makes the two passes
 * comparable — a participant who wanders off-script is still measured on the
 * same sequence of pages afterwards.
 *
 * All of the state lives in `@/lib/tasks/runStore`, because most of what
 * moves it arrives from outside React: a submitted quiz attempt, a biometrics
 * tick reporting enrolment is done. Route tasks are the exception — a
 * pathname is only observable from a hook — and are reported below.
 */

const DIM = "#8b949e";
const OK = "#3fb950";
const WARN = "#d29922";

export default function TaskPanel() {
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // A route task completes by arriving, and a route change is only visible
  // after the render that caused it.
  useEffect(() => {
    completeVisit(pathname);
  }, [pathname]);

  // Null until hydration: the server cannot know how far a run has got.
  if (!state) return null;

  const run = taskRuns[state.phase];
  const doneCount = state[state.phase];
  const current: Task | undefined = run.tasks[doneCount];
  const runComplete = doneCount >= run.tasks.length;
  const collapsed = state.collapsed;
  const warmup = state.warmup;

  const accent = state.phase === "testing" ? OK : WARN;
  const waitingForModel = runComplete && state.phase === "training";

  let footnote: string;
  if (state.phase === "testing") {
    footnote = runComplete
      ? "Test pass complete — the score on the right is the verdict."
      : "Scoring is live; the widget on the right follows this run.";
  } else if (waitingForModel) {
    footnote = warmup
      ? `All tasks done — keep moving until enrolment finishes (${warmup.done}/${warmup.total}).`
      : "All tasks done — keep moving until the model finishes enrolling.";
  } else {
    footnote = warmup
      ? `Enrolment ${warmup.done}/${warmup.total} windows.`
      : "Waiting for the first biometrics tick…";
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Show the task list"
        className="fixed left-4 top-[60px] z-50 flex max-w-[22rem] items-center gap-2 rounded-full bg-[#161b22]/95 py-2 pl-3 pr-4 text-left text-[12px] text-[#e6edf3] shadow-xl ring-1 ring-white/10"
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <span className="shrink-0 font-semibold">{run.title}</span>
        <span className="shrink-0 text-white/60">
          {doneCount}/{run.tasks.length}
        </span>
        {current ? (
          <span className="truncate text-white/70">· {current.label}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className="fixed left-4 top-[60px] z-50 w-72 select-none rounded-lg border border-white/10 bg-[#161b22] p-3 text-[12px] text-[#e6edf3] shadow-xl"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: accent }}
          />
          {run.title}
          <span className="font-normal text-white/50">
            {doneCount}/{run.tasks.length} tasks
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="Collapse"
          aria-label="Collapse task list"
          className="rounded border border-white/15 px-1.5 py-0.5 text-[11px] leading-none hover:border-white/40"
        >
          –
        </button>
      </div>

      <p className="mb-2 text-[10px] leading-snug text-white/40">{run.blurb}</p>

      <ol className="flex flex-col gap-1.5">
        {run.tasks.map((task, index) => {
          const done = index < doneCount;
          const active = index === doneCount;
          return (
            <li
              key={task.id}
              className={
                "rounded border px-2 py-1.5 transition-colors " +
                (active
                  ? "border-white/25 bg-white/[0.06]"
                  : "border-transparent")
              }
            >
              <div className="flex gap-2">
                <span
                  className="mt-[1px] w-4 shrink-0 text-center text-[11px]"
                  style={{ color: done ? OK : active ? accent : DIM }}
                >
                  {done ? "✓" : index + 1}
                </span>
                <div className="min-w-0">
                  <div
                    className={
                      done
                        ? "text-white/35 line-through"
                        : active
                          ? "text-white"
                          : "text-white/55"
                    }
                  >
                    {task.label}
                  </div>
                  {active ? (
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] text-white/40">
                        {task.where}
                      </span>
                      <button
                        type="button"
                        onClick={skipCurrentTask}
                        title="Can't find it? Move on to the next task"
                        className="shrink-0 text-[10px] text-white/40 underline underline-offset-2 hover:text-white/70"
                      >
                        skip
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-2 text-[10px] leading-snug" style={{ color: waitingForModel ? WARN : DIM }}>
        {footnote}
      </p>

      <div className="mt-2 flex gap-1">
        <button
          type="button"
          onClick={restartRun}
          title="Start the task script again from task 1 of the training pass"
          className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40"
        >
          Restart
        </button>
        {state.phase === "training" ? (
          <button
            type="button"
            onClick={skipToTesting}
            title="Skip the rest of the training pass and start the scored run"
            className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40"
          >
            Skip to testing
          </button>
        ) : null}
      </div>
    </div>
  );
}
