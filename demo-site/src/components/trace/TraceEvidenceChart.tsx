"use client";

import { useTrace } from "@/components/trace/TraceProvider";
import { trustScore } from "@/lib/trace/score";

/**
 * Live evidence trace during a test run.
 *
 * Each point is the accumulated evidence `S` after one scored sub-task (§6.3),
 * squashed onto 0–100 between the two SPRT boundaries. The bands behind it are
 * those boundaries: cross into red and the run locks out, cross into green and
 * it verifies.
 *
 * **This deliberately contradicts §2.2**, which says "the test run shows no live
 * percentage" — a live number is a high-variance estimator early on and invites
 * the participant to game it. It is here because a demo needs something to
 * watch, and the mid-run handover is the moment worth watching. For a real
 * study run, hide it.
 */

const WIDTH = 300;
const HEIGHT = 72;
const PAD = 2;

/** Band edges on the 0–100 trust scale. */
const WATCH = 30;
const OK = 60;

function zoneOf(trust: number): "ok" | "watch" | "alarm" {
  if (trust >= OK) return "ok";
  if (trust >= WATCH) return "watch";
  return "alarm";
}

export default function TraceEvidenceChart() {
  const { scores, thresholds, phase, verdict } = useTrace();

  // Nothing to draw until the backend can turn a score into evidence.
  if (!thresholds) return null;

  const trusts = scores.map((score) => trustScore(score.evidence, thresholds));
  const latest = trusts[trusts.length - 1];
  const zone = latest === undefined ? "watch" : zoneOf(latest);

  const toY = (trust: number): number =>
    PAD + (1 - trust / 100) * (HEIGHT - 2 * PAD);

  /*
   * The x axis is "sub-tasks scored so far", but it is drawn against a fixed
   * span so the line grows left to right instead of rescaling under itself on
   * every point — a chart that redraws its own history is unreadable live.
   */
  const span = Math.max(12, trusts.length);
  const toX = (index: number): number =>
    PAD + (index / Math.max(1, span - 1)) * (WIDTH - 2 * PAD);

  const points = trusts.map((trust, index) => `${toX(index)},${toY(trust)}`);
  const area =
    points.length > 1
      ? `M${toX(0)},${HEIGHT - PAD} L${points.join(" L")} L${toX(trusts.length - 1)},${HEIGHT - PAD} Z`
      : "";

  return (
    <div className="trace-chart">
      <div className="trace-chart-head">
        <span>Live confidence</span>
        <span className={`trace-chart-value is-${zone}`}>
          {latest === undefined ? "—" : `${latest}`}
        </span>
      </div>

      <svg
        className="trace-chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          latest === undefined
            ? "No evidence yet"
            : `Confidence ${latest} of 100 after ${trusts.length} sub-tasks`
        }
      >
        {/* Decision bands — the SPRT boundaries, not decoration. */}
        <rect x="0" y={toY(100)} width={WIDTH} height={toY(OK) - toY(100)} className="trace-band is-ok" />
        <rect x="0" y={toY(OK)} width={WIDTH} height={toY(WATCH) - toY(OK)} className="trace-band is-watch" />
        <rect x="0" y={toY(WATCH)} width={WIDTH} height={toY(0) - toY(WATCH)} className="trace-band is-alarm" />

        {area ? <path d={area} className={`trace-chart-area is-${zone}`} /> : null}
        {points.length > 1 ? (
          <polyline points={points.join(" ")} className={`trace-chart-line is-${zone}`} />
        ) : null}
        {points.length > 0 ? (
          <circle
            cx={toX(trusts.length - 1)}
            cy={toY(latest ?? 0)}
            r="3.5"
            className={`trace-chart-dot is-${zone}`}
          />
        ) : null}
      </svg>

      <p className="trace-chart-foot">
        {scores.length === 0
          ? "Waiting for the first scored sub-task"
          : `${scores.length} sub-task${scores.length === 1 ? "" : "s"} scored · S = ${
              scores[scores.length - 1]?.evidence.toFixed(2) ?? "0"
            } nats`}
        {phase === "finished" && verdict === "locked" ? " · locked out" : ""}
      </p>
    </div>
  );
}
