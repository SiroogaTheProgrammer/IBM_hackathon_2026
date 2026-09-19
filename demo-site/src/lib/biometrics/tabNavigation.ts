/**
 * TypeScript port of `behavioral_biometrics_nn/modules/tab_navigation.py`:
 * Markov transition surprise + dwell-time z-score + rolling sequence
 * entropy. Pure statistics, no ML - state is a plain serializable object so
 * it round-trips through the Redis-backed session document.
 */

export type TabNavState = {
  transitions: Record<string, Record<string, number>>;
  dwell: Record<string, number[]>;
  recent: string[];
  nTransitions: number;
  prevTab: string | null;
  lastRisk: number;
  lastConfidence: number;
  stickyRemaining: number;
};

export function initTabNavState(): TabNavState {
  return {
    transitions: {},
    dwell: {},
    recent: [],
    nTransitions: 0,
    prevTab: null,
    lastRisk: 0,
    lastConfidence: 0,
    stickyRemaining: 0,
  };
}

const ENTROPY_WINDOW = 5;
const WARMUP_TRANSITIONS = 8;
const LAPLACE_ALPHA = 1.0;
const SURPRISE_CAP_BITS = 6.0;
const OUT_OF_ORDER_PROB = 0.05;
const STICKY_TICKS = 3;

export type ModuleOutcome = {
  risk: number;
  confidence: number;
  status: "active" | "warming" | "inactive";
  detail: Record<string, unknown>;
};

function transitionProbability(state: TabNavState, source: string, target: string): number {
  // Auto-vivify (mirrors Python's `defaultdict` access side effect) *before*
  // counting distinct sources, so a first-seen source is included in its own
  // Laplace-smoothing denominator, exactly as `self.transitions[source]`
  // creating the entry does in the original.
  const row = (state.transitions[source] ??= {});
  const nTargets = Math.max(Object.keys(state.transitions).length + 1, 2);
  const total = Object.values(row).reduce((a, b) => a + b, 0) + LAPLACE_ALPHA * nTargets;
  return ((row[target] ?? 0) + LAPLACE_ALPHA) / total;
}

function dwellZscore(state: TabNavState, tab: string, dwell: number): number {
  const history = state.dwell[tab] ?? [];
  if (history.length < 3) return 0;
  const m = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((a, b) => a + (b - m) ** 2, 0) / history.length;
  const std = Math.sqrt(variance);
  return std < 1e-6 ? 0 : (dwell - m) / std;
}

function sequenceEntropy(recent: string[]): number {
  if (recent.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const tab of recent) counts.set(tab, (counts.get(tab) ?? 0) + 1);
  const total = recent.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Mutates `state` in place; the caller persists it back to the session
 * document afterward. */
export function updateTabNavigation(
  state: TabNavState,
  visits: { tab: string; dwell: number }[],
): ModuleOutcome {
  if (!visits.length) {
    // A tab switch is a single instantaneous event; without this, a
    // genuinely suspicious jump goes silent (confidence 0) the very next
    // tick and can never survive 3 consecutive escalation cycles. Keep the
    // last verdict alive for a few quiet ticks instead.
    if (state.stickyRemaining > 0) {
      state.stickyRemaining -= 1;
      return {
        risk: state.lastRisk,
        confidence: state.lastConfidence,
        status: "active",
        detail: { sticky: true, ticks_left: state.stickyRemaining },
      };
    }
    return { risk: 0, confidence: 0, status: "inactive", detail: { reason: "no tab changes in this window" } };
  }

  const surprises: number[] = [];
  const zscores: number[] = [];
  let outOfOrder = 0;

  for (const visit of visits) {
    const tab = String(visit.tab ?? "");
    const dwell = Number(visit.dwell ?? 0);
    if (!tab) continue;

    if (state.prevTab !== null) {
      const p = transitionProbability(state, state.prevTab, tab);
      surprises.push(Math.min(-Math.log2(p), SURPRISE_CAP_BITS));
      if (p < OUT_OF_ORDER_PROB) outOfOrder++;
      state.transitions[state.prevTab][tab] = (state.transitions[state.prevTab][tab] ?? 0) + 1;
      state.nTransitions++;
    }

    if (dwell > 0 && state.prevTab !== null) {
      zscores.push(Math.abs(dwellZscore(state, state.prevTab, dwell)));
      const arr = state.dwell[state.prevTab] ?? [];
      arr.push(dwell);
      state.dwell[state.prevTab] = arr;
    }

    state.recent.push(tab);
    if (state.recent.length > ENTROPY_WINDOW) state.recent.shift();
    state.prevTab = tab;
  }

  if (state.nTransitions < WARMUP_TRANSITIONS) {
    return {
      risk: 0,
      confidence: 0,
      status: "warming",
      detail: { transitions_seen: state.nTransitions, need: WARMUP_TRANSITIONS },
    };
  }

  const surprise = surprises.length ? Math.max(...surprises) : 0;
  const zscore = zscores.length ? Math.max(...zscores) : 0;
  const entropy = sequenceEntropy(state.recent);

  const risk = Math.min(
    1.0,
    0.6 * (surprise / SURPRISE_CAP_BITS) +
      0.25 * Math.min(zscore / 3.0, 1.0) +
      0.15 * Math.min(entropy / Math.log2(Math.max(state.recent.length, 2)), 1.0),
  );
  const confidence = Math.min(1.0, state.nTransitions / (2 * WARMUP_TRANSITIONS));

  state.lastRisk = risk;
  state.lastConfidence = confidence;
  state.stickyRemaining = STICKY_TICKS;

  return {
    risk,
    confidence,
    status: "active",
    detail: {
      transition_surprise_bits: surprise,
      dwell_zscore: zscore,
      sequence_entropy: entropy,
      out_of_order_flag: outOfOrder > 0 ? 1 : 0,
      path: [...state.recent],
    },
  };
}
