"use client";

import { useState } from "react";
import TraceLogo from "@/components/trace/TraceLogo";
import { useTrace } from "@/components/trace/TraceProvider";
import { FLOW_LENGTH, taskOffsets, tasks } from "@/data/taskFlow";
import { LOWER_THRESHOLD, UPPER_THRESHOLD } from "@/lib/trace/score";

/**
 * The study overlay: the only part of this site that is not a MyCourses clone.
 *
 * It is the participant's whole interface to the experiment — it explains the
 * two phases, hands out the fixed flow one step at a time, and reports the
 * verdict. It deliberately shows no live score during a test run (§2.2): a
 * running percentage is a high-variance estimator and invites the participant
 * to game it.
 */
export default function TraceUiCard() {
  const trace = useTrace();
  const [collapsed, setCollapsed] = useState(false);

  const { phase, position, index, verdict, enrollment, collectionMode } = trace;
  const running =
    phase === "training" || phase === "testing" || phase === "collecting";

  return (
    <aside className="trace-card" data-trace-ui aria-label="Trace study panel">
      <header className="trace-head">
        <TraceLogo height={16} />
        <span className="trace-phase">{phaseLabel(phase, verdict)}</span>
        <button
          type="button"
          className="trace-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand Trace panel" : "Collapse Trace panel"}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "+" : "–"}
        </button>
      </header>

      {collapsed ? null : (
        <div className="trace-body">
          <CollectionToggle />

          {phase === "idle" && !collectionMode ? <IdleBody /> : null}
          {phase === "idle" && collectionMode ? <CollectIdleBody /> : null}
          {phase === "enrolled" ? <EnrolledBody covered={enrollment?.covered ?? 0} /> : null}
          {running ? <RunBody /> : null}
          {phase === "finished" ? <ResultBody /> : null}
          {phase === "collected" ? <CollectedBody /> : null}

          <Controls />

          {collectionMode ? null : (
            <p className="trace-foot">
              Heuristic baseline — the trained encoder and AS-norm cohort are
              not wired up yet, so treat the verdict as a wiring check, not a
              result.
            </p>
          )}
        </div>
      )}

      {collapsed && running && position ? (
        <p className="trace-mini">
          {index + 1}/{FLOW_LENGTH} · {position.subtask.instruction}
        </p>
      ) : null}
    </aside>
  );
}

/* --------------------------------------------------------------- bodies --- */

function IdleBody() {
  return (
    <>
      <p className="trace-lede">
        Trace checks whether the person at the mouse is the person who enrolled
        — from cursor movement alone, never from what you click.
      </p>

      <ol className="trace-steps">
        <li>
          <strong>Start training.</strong> You get a fixed sequence of 5 tasks,
          one step at a time. Finishing it enrols your movement as the template.
        </li>
        <li>
          <strong>Start test run.</strong> The same 5 tasks again. No live score
          — at the end you get a verdict, and if the movement stops matching the
          run is cut short before you finish.
        </li>
      </ol>

      <p className="trace-note">
        Roughly 2 minutes per run, {FLOW_LENGTH} steps across {tasks.length}{" "}
        tasks. Both runs must be the same sequence, which is what makes the
        comparison meaningful.
      </p>
    </>
  );
}

function EnrolledBody({ covered }: { covered: number }) {
  return (
    <>
      <p className="trace-lede">
        Enrolled. {covered} of {FLOW_LENGTH} steps produced a usable movement
        template.
      </p>
      <p className="trace-note">
        A test run walks the same 5 tasks. Hand the mouse to someone else
        partway through to see the lockout fire mid-task; run it yourself to see
        it verify. Train again to re-enrol as a different person.
      </p>
    </>
  );
}

function RunBody() {
  const { phase, position, index, scores, offTrack } = useTrace();
  if (!position) return null;

  const { task, taskNumber, subtask, subtaskNumber } = position;

  return (
    <>
      <div className="trace-meta">
        <span>
          Task {taskNumber} of {tasks.length}
        </span>
        <span>
          Step {index + 1} / {FLOW_LENGTH}
        </span>
      </div>

      <TaskProgress index={index} />

      <h3 className="trace-task-title">{task.title}</h3>
      <p className="trace-note">{task.goal}</p>

      <p className="trace-instruction">
        <span className="trace-step-badge">
          {taskNumber}.{subtaskNumber}
        </span>
        {subtask.instruction}
      </p>

      {offTrack ? (
        <p className="trace-note">
          This step lives on <code>{subtask.route}</code> — navigate back there
          to carry on.
        </p>
      ) : null}

      {phase === "testing" ? <TestIndicator scored={scores.length} /> : null}
    </>
  );
}

function ResultBody() {
  const { verdict, index, scores, evidence, trust } = useTrace();

  const copy: Record<string, { title: string; note: string }> = {
    verified: {
      title: "Verified",
      note: "Evidence crossed the upper threshold — the movement matched the enrolled user.",
    },
    inconclusive: {
      title: "Step-up challenge",
      note: "The flow ended without enough evidence either way. In the product this is where a second factor is asked for.",
    },
    locked: {
      title: "Locked out",
      note: `Evidence crossed the impostor threshold at step ${index} of ${FLOW_LENGTH} and the run was stopped there.`,
    },
    running: {
      title: "Stopped",
      note: "The run ended before a decision was reached.",
    },
  };

  const result = copy[verdict] ?? copy.running;

  return (
    <>
      <div className={`trace-verdict is-${verdict}`}>
        <span className="trace-verdict-title">{result?.title}</span>
        {trust === null ? null : (
          <span className="trace-verdict-score">{trust}/100</span>
        )}
      </div>

      <p className="trace-note">{result?.note}</p>

      <dl className="trace-readout">
        <div>
          <dt>Evidence S</dt>
          <dd>{evidence === null ? "—" : `${evidence.toFixed(2)} nats`}</dd>
        </div>
        <div>
          <dt>Thresholds</dt>
          <dd>
            {LOWER_THRESHOLD.toFixed(2)} / {UPPER_THRESHOLD.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>Sub-tasks scored</dt>
          <dd>
            {scores.length} of {index}
          </dd>
        </div>
      </dl>
    </>
  );
}

function CollectIdleBody() {
  const { participant } = useTrace();

  return (
    <>
      <p className="trace-lede">
        Recording mode. Walk the same {FLOW_LENGTH}-step flow once; every cursor
        sample and click is logged and written out at the end.
      </p>
      <p className="trace-note">
        Written to <code>demo-site/data/collected/user-{participant}.csv</code>{" "}
        — SapiMouse columns (<code>client timestamp, button, state, x, y</code>)
        plus the task, sub-task, clicked element and viewport. Nothing is scored
        and nothing is enrolled.
      </p>
    </>
  );
}

function CollectedBody() {
  const { lastSave, participant } = useTrace();

  if (!lastSave) {
    return <p className="trace-lede">Run finished, but nothing was recorded.</p>;
  }

  const { status } = lastSave;
  const plate =
    status === "saved" ? "is-saved" : status === "failed" ? "is-locked" : "";

  return (
    <>
      <div className={`trace-verdict ${plate}`}>
        <span className="trace-verdict-title">
          {status === "saved"
            ? "Written"
            : status === "failed"
              ? "Not written"
              : "Writing…"}
        </span>
        <span className="trace-verdict-score">
          user-{lastSave.participant}.csv
        </span>
      </div>

      <dl className="trace-readout">
        <div>
          <dt>Samples</dt>
          <dd>{lastSave.rows.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{lastSave.seconds}s</dd>
        </div>
        <div>
          <dt>Mean rate</dt>
          <dd>
            {lastSave.seconds > 0
              ? Math.round(lastSave.rows / lastSave.seconds)
              : 0}{" "}
            /s
          </dd>
        </div>
      </dl>

      {status === "saved" ? (
        <p className="trace-note">
          <code>demo-site/{lastSave.path}</code>. The next run will be{" "}
          <code>user-{participant}.csv</code>.
        </p>
      ) : null}

      {status === "failed" ? (
        <p className="trace-note">
          {lastSave.error}. The run is still in memory — retry, or take a copy
          through the browser.
        </p>
      ) : null}
    </>
  );
}

/**
 * Localhost-only. Collection mode records whoever is at the machine and writes
 * a file to their disk, so it must not exist on a deployed copy of the demo.
 */
function CollectionToggle() {
  const { collectionAvailable, collectionMode, setCollectionMode, phase } =
    useTrace();

  if (!collectionAvailable) return null;

  const busy =
    phase === "training" || phase === "testing" || phase === "collecting";

  return (
    <div className="trace-switch-row">
      <span id="trace-collect-label">Data collection</span>
      <button
        type="button"
        role="switch"
        aria-checked={collectionMode}
        aria-labelledby="trace-collect-label"
        disabled={busy}
        className={`trace-switch${collectionMode ? " is-on" : ""}`}
        onClick={() => setCollectionMode(!collectionMode)}
      >
        <span className="trace-switch-knob" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------- pieces --- */

function TaskProgress({ index }: { index: number }) {
  return (
    <div className="trace-progress" aria-hidden="true">
      {tasks.map((task, position) => {
        const start = taskOffsets[position] ?? 0;
        const done = Math.min(task.subtasks.length, Math.max(0, index - start));
        const percent = (done / task.subtasks.length) * 100;
        const active = index >= start && index < start + task.subtasks.length;

        return (
          <span
            key={task.id}
            className={`trace-progress-seg${active ? " is-active" : ""}`}
            style={{ flexGrow: task.subtasks.length }}
          >
            <span style={{ width: `${percent}%` }} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * §2.2: the run shows a trust indicator only once meaningful evidence exists,
 * and never a number while it is still accumulating.
 */
function TestIndicator({ scored }: { scored: number }) {
  const { evidence } = useTrace();

  if (evidence === null) {
    return (
      <p className="trace-indicator is-waiting">
        Gathering evidence — {scored} sub-task{scored === 1 ? "" : "s"} scored
      </p>
    );
  }

  const healthy = evidence > 0;
  return (
    <p className={`trace-indicator ${healthy ? "is-ok" : "is-watch"}`}>
      {healthy ? "Consistent with the enrolled user" : "Diverging from the enrolled user"}
    </p>
  );
}

/** A failed write offers a retry and a browser-download escape hatch. */
function CollectedControls() {
  const { lastSave, startCollection, saveAgain, downloadLastRun } = useTrace();
  const failed = lastSave?.status === "failed";

  return (
    <div className="trace-actions">
      {failed ? (
        <>
          <button
            type="button"
            className="trace-btn trace-btn--primary"
            onClick={saveAgain}
          >
            Retry write
          </button>
          <button type="button" className="trace-btn" onClick={downloadLastRun}>
            Download instead
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="trace-btn trace-btn--primary"
            onClick={startCollection}
          >
            Record another run
          </button>
          <button type="button" className="trace-btn" onClick={downloadLastRun}>
            Download copy
          </button>
        </>
      )}
    </div>
  );
}

function Controls() {
  const {
    phase,
    collectionMode,
    startTraining,
    startTest,
    startCollection,
    abort,
  } = useTrace();

  if (phase === "training" || phase === "testing" || phase === "collecting") {
    return (
      <div className="trace-actions">
        <button type="button" className="trace-btn" onClick={abort}>
          Cancel run
        </button>
      </div>
    );
  }

  if (collectionMode) {
    return phase === "collected" ? (
      <CollectedControls />
    ) : (
      <div className="trace-actions">
        <button
          type="button"
          className="trace-btn trace-btn--primary"
          onClick={startCollection}
        >
          Start recording
        </button>
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <div className="trace-actions">
        <button
          type="button"
          className="trace-btn trace-btn--primary"
          onClick={startTraining}
        >
          Start training
        </button>
      </div>
    );
  }

  return (
    <div className="trace-actions">
      <button
        type="button"
        className="trace-btn trace-btn--primary"
        onClick={startTest}
      >
        {phase === "finished" ? "Run another test" : "Start test run"}
      </button>
      <button type="button" className="trace-btn" onClick={startTraining}>
        Train again
      </button>
    </div>
  );
}

function phaseLabel(phase: string, verdict: string): string {
  switch (phase) {
    case "training":
      return "Enrolling";
    case "testing":
      return "Test run";
    case "collecting":
      return "Recording";
    case "collected":
      return "Saved";
    case "enrolled":
      return "Enrolled";
    case "finished":
      return verdict === "locked" ? "Stopped" : "Complete";
    default:
      return "Not enrolled";
  }
}
