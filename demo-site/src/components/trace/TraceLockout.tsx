"use client";

import { useState } from "react";
import Link from "next/link";
import { useTrace } from "@/components/trace/TraceProvider";

/**
 * The lockout alert — §2.2's "immediate redirect to a suspicious activity
 * detected page, mid-task", and §9 item 6's lockout UI.
 *
 * It is a corner panel rather than a redirect on purpose: a redirect throws
 * away the screen the handover happened on, and on stage the interesting thing
 * is seeing the alert land *over* the task the impostor was halfway through.
 * The run is already stopped by the time this renders — the engine ends it the
 * moment evidence crosses the lower boundary — so this is the notification, not
 * the enforcement.
 */
export default function TraceLockout() {
  const { phase, verdict, index, scores } = useTrace();
  const [dismissed, setDismissed] = useState(false);

  const locked = phase === "finished" && verdict === "locked";
  if (!locked || dismissed) return null;

  return (
    <aside
      className="trace-lockout"
      data-trace-ui
      role="alert"
      aria-live="assertive"
    >
      <div className="trace-lockout-head">
        <span className="trace-lockout-icon" aria-hidden="true">
          <CrossGlyph />
        </span>
        <div className="trace-lockout-title">
          <strong>Suspicious activity detected</strong>
          <span>Sign in again to continue</span>
        </div>
        <button
          type="button"
          className="trace-lockout-close"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>

      <p className="trace-lockout-body">
        The way this session is being driven stopped matching the enrolled user
        at step {index} of the flow, after {scores.length} scored sub-task
        {scores.length === 1 ? "" : "s"}.
      </p>

      <Link href="/login" className="trace-lockout-action">
        Sign in again
      </Link>
    </aside>
  );
}

/** The red X. Drawn rather than imported so it inherits the panel's colour. */
function CrossGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
