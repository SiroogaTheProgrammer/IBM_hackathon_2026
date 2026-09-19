"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Global floating HUD: captures mouse, keystroke and route-navigation
 * telemetry from every page (mounted once in the root layout, so state
 * survives client-side navigation) and posts a batch every second to
 * `/api/biometrics/*` - Next.js Route Handlers backed by the ported
 * TypeScript biometrics engine in `src/lib/biometrics/` (no separate Python
 * server needed; session state lives in Upstash Redis). See
 * `src/lib/biometrics/session.ts` for the request/response contract this
 * component depends on.
 */

/** Keep in sync with `MouseEngine` in src/lib/biometrics/types.ts. */
type MouseEngine =
  | "balabit_features_embed"
  | "balabit_autoencoder"
  | "sapimouse_features_embed"
  | "little_boy";

/** `pluginId` is the `plugin_id` that engine's module reports in `modules[]`,
 * so the panel can show that model's own estimate alongside composite risk. */
const ENGINES: { id: MouseEngine; label: string; blurb: string; pluginId: string }[] = [
  {
    id: "balabit_features_embed",
    label: "balabit_features_embed",
    pluginId: "mouse_base_v1",
    blurb: "32 window features → trained siamese encoder, scored against your own embedding gallery",
  },
  {
    id: "balabit_autoencoder",
    label: "balabit_autoencoder",
    pluginId: "mouse_autoencoder_v1",
    blurb: "26 window features → autoencoder trained on your warm-up only, scored by reconstruction error",
  },
  {
    id: "sapimouse_features_embed",
    label: "sapimouse_features_embed",
    pluginId: "mouse_sapimouse_v1",
    blurb: "60 stroke features → SapiMouse encoder on TensorFlow.js, scored against your own embedding gallery (needs ~15s of movement per window)",
  },
  {
    id: "little_boy",
    label: "little_boy",
    pluginId: "mouse_littleboy_v1",
    blurb: "ML_Models/train_pipeline_1.py ported to TensorFlow.js: one row per raw event (x, y, time_delta, button/state one-hots) → 32-16-8 autoencoder trained on ~90s of your own clicking and moving, scored by reconstruction error",
  },
];

/** Engines whose warm-up is a training capture rather than a gallery of
 * embeddings, so the panel labels the counter accordingly. */
const TRAINING_ENGINES: MouseEngine[] = ["balabit_autoencoder", "little_boy"];

type MouseSample = { t: number; x: number; y: number; button: string; state: string };
type KeySample = { key: string; dwell: number; flight: number };
type NavSample = { tab: string; dwell: number };

type SessionInfo = {
  status: string;
  gallery_size: number;
  warmup_size: number;
  gallery_mode: string;
};

type ModuleResult = {
  plugin_id: string;
  risk_score: number;
  confidence: number;
  status: string;
};

type TickResponse = {
  idle?: boolean;
  composite_risk: number | null;
  verdict: string;
  streak: number;
  escalated: boolean;
  threshold: number;
  active_modules: number;
  modules?: ModuleResult[];
  session: SessionInfo;
};

const TICK_MS = 1000;
const ENGINE_STORAGE_KEY = "bio_engine";

/**
 * Last-used engine, so a client-side navigation does not silently flip back to
 * the default mid-session. Returns the default during SSR, where there is no
 * localStorage; the widget only renders its panel on the client anyway.
 */
function readStoredEngine(): MouseEngine {
  if (typeof window === "undefined") return "balabit_features_embed";
  const saved = window.localStorage.getItem(ENGINE_STORAGE_KEY) as MouseEngine | null;
  return saved && ENGINES.some((e) => e.id === saved) ? saved : "balabit_features_embed";
}
const API_BASE = "/api/biometrics";
const DIM = "#8b949e";
const OK = "#3fb950";
const WARN = "#d29922";
const BAD = "#f85149";
const RISK_HISTORY_LEN = 30; // ~30s of history at one tick/second

function severityColor(risk: number, threshold: number): string {
  if (risk >= threshold) return BAD;
  if (risk >= threshold * 0.7) return WARN;
  return OK;
}

/** Tiny inline SVG line+area chart of the last `RISK_HISTORY_LEN` risk samples. */
function RiskSparkline({ values, color }: { values: number[]; color: string }) {
  const width = 224;
  const height = 44;
  if (values.length < 2) {
    return (
      <div className="flex h-11 items-center justify-center text-[10px] text-white/40">
        collecting data…
      </div>
    );
  }
  const stepX = width / (RISK_HISTORY_LEN - 1);
  const startX = width - (values.length - 1) * stepX;
  const points = values
    .map((v, i) => {
      const x = startX + i * stepX;
      const y = height - Math.min(1, Math.max(0, v)) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const endX = startX + (values.length - 1) * stepX;
  const areaPoints = `${startX.toFixed(1)},${height} ${points} ${endX.toFixed(1)},${height}`;
  return (
    <svg width={width} height={height} className="block overflow-visible">
      <polyline points={areaPoints} fill={color} fillOpacity={0.15} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Wraps the expanded panel so it grows/fades in on mount instead of popping in instantly. */
function ExpandedPanel({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={`mb-1 w-64 origin-bottom-right rounded-lg border border-white/10 bg-[#161b22] p-3 text-[12px] text-[#e6edf3] shadow-xl transition-all duration-200 ${
        shown ? "scale-100 opacity-100" : "scale-90 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

export default function BiometricsWidget() {
  const pathname = usePathname();
  const [data, setData] = useState<TickResponse | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [riskHistory, setRiskHistory] = useState<number[]>([]);
  // Lazy initialiser rather than an effect: restoring the persisted choice
  // after mount would render one frame with the wrong engine selected, and
  // the tick loop could fire against it in between.
  const [engine, setEngine] = useState<MouseEngine>(readStoredEngine);
  const stoppedRef = useRef(false);
  // The tick loop is mounted once and never re-created, so it reads the
  // current engine through a ref rather than closing over stale state.
  const engineRef = useRef<MouseEngine>(engine);
  // Fitting the autoencoder happens inside a tick request and can outlast the
  // 1 s interval. Without this guard two ticks would race to train, and the
  // loser's work would be thrown away.
  const inFlight = useRef(false);

  const mouseBuf = useRef<MouseSample[]>([]);
  const keyBuf = useRef<KeySample[]>([]);
  const navBuf = useRef<NavSample[]>([]);
  const keyDownAt = useRef<Record<string, number>>({});
  const lastKeyUp = useRef<number | null>(null);
  const buttonDown = useRef(false);
  const currentPath = useRef(pathname);
  const enteredAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);

  // Each route is a "tab" for the tab-navigation extension: record dwell
  // time on the page just left every time the pathname changes.
  useEffect(() => {
    const now = performance.now();
    if (currentPath.current !== pathname) {
      navBuf.current.push({ tab: currentPath.current, dwell: (now - enteredAt.current) / 1000 });
      currentPath.current = pathname;
      enteredAt.current = now;
    }
  }, [pathname]);

  useEffect(() => {
    const stamp = () => performance.now() / 1000;

    const onMove = (e: MouseEvent) => {
      if (stoppedRef.current) return;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: "NoButton", state: buttonDown.current ? "Drag" : "Move",
      });
    };
    const onDown = (e: MouseEvent) => {
      if (stoppedRef.current) return;
      buttonDown.current = true;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: e.button === 2 ? "Right" : "Left", state: "Pressed",
      });
    };
    const onUp = (e: MouseEvent) => {
      if (stoppedRef.current) return;
      buttonDown.current = false;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: e.button === 2 ? "Right" : "Left", state: "Released",
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (stoppedRef.current) return;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: "Scroll", state: e.deltaY < 0 ? "Up" : "Down",
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (stoppedRef.current) return;
      if (keyDownAt.current[e.key] === undefined) keyDownAt.current[e.key] = stamp();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (stoppedRef.current) return;
      const down = keyDownAt.current[e.key];
      if (down === undefined) return;
      delete keyDownAt.current[e.key];
      const up = stamp();
      keyBuf.current.push({
        key: e.key,
        dwell: (up - down) * 1000,
        flight: lastKeyUp.current === null ? 0 : (down - lastKeyUp.current) * 1000,
      });
      lastKeyUp.current = up;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const tick = async () => {
      if (inFlight.current) return;
      if (stoppedRef.current) {
        mouseBuf.current = [];
        navBuf.current = [];
        keyBuf.current = [];
        return;
      }

      const payload = {
        engine: engineRef.current,
        events: mouseBuf.current,
        nav: navBuf.current,
        keys: keyBuf.current,
        device: { blur_count: 0, resize_count: 0, screen: `${window.screen.width}x${window.screen.height}` },
      };
      mouseBuf.current = [];
      navBuf.current = [];
      keyBuf.current = [];

      inFlight.current = true;
      try {
        const res = await fetch(`${API_BASE}/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as TickResponse;
        setData(json);
        setUnreachable(false);
        setRiskHistory((prev) => [...prev, json.composite_risk ?? 0].slice(-RISK_HISTORY_LEN));
      } catch {
        setUnreachable(true);
      } finally {
        inFlight.current = false;
      }
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const handleReset = async () => {
    try {
      await fetch(`${API_BASE}/reset`, { method: "POST" });
      setData(null);
      setRiskHistory([]);
    } catch {
      setUnreachable(true);
    }
  };

  /** Quitting test mode: stop capturing/sending telemetry and wipe the
   * stored gallery embeddings + risk model server-side, so the next session
   * starts from a clean slate instead of resuming with old biometric data. */
  const handleQuit = async () => {
    stoppedRef.current = true;
    setStopped(true);
    mouseBuf.current = [];
    keyBuf.current = [];
    navBuf.current = [];
    setRiskHistory([]);
    setData(null);
    try {
      await fetch(`${API_BASE}/reset`, { method: "POST" });
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    }
  };

  /**
   * Switch which mouse model scores this session. Each engine keeps its own
   * warm-up and trained model server-side, so switching back resumes rather
   * than restarting - but the risk sparkline is cleared, since the two
   * engines' scores are not the same series.
   */
  const handleEngineChange = (next: MouseEngine) => {
    setEngine(next);
    engineRef.current = next;
    window.localStorage.setItem(ENGINE_STORAGE_KEY, next);
    setRiskHistory([]);
    setData(null);
  };

  const handleResume = () => {
    stoppedRef.current = false;
    setStopped(false);
  };

  // The selected mouse model's own estimate, separate from composite risk
  // (which folds in tab-navigation and keystroke). This is the number the
  // autoencoder engines are actually being asked for: how unlike the enrolled
  // user this second of activity looks.
  const selectedEngine = ENGINES.find((e) => e.id === engine);
  const mouseModule = data?.modules?.find((m) => m.plugin_id === selectedEngine?.pluginId);
  const modelRisk = mouseModule?.status === "active" ? mouseModule.risk_score : null;

  const session = data?.session;
  const warmupSize = session?.warmup_size ?? 0;
  const gallerySize = session?.gallery_size ?? 0;
  const isWarming = session?.status === "warming";
  const trainingPct = warmupSize > 0 ? Math.min(100, Math.round((gallerySize / warmupSize) * 100)) : 0;
  const risk = data?.composite_risk ?? null;
  const threshold = data?.threshold ?? 0.8;
  const riskPct = risk !== null ? Math.round(risk * 100) : 0;

  let coreColor = DIM;
  let phaseLabel = "connecting…";
  if (stopped) {
    coreColor = DIM;
    phaseLabel = "stopped — embeddings cleared";
  } else if (unreachable) {
    coreColor = DIM;
    phaseLabel = "backend offline";
  } else if (data?.idle) {
    coreColor = DIM;
    phaseLabel = "idle";
  } else if (isWarming) {
    coreColor = WARN;
    phaseLabel = `training ${gallerySize}/${warmupSize}`;
  } else if (risk !== null) {
    coreColor = severityColor(risk, threshold);
    phaseLabel = data?.escalated ? "elevated risk" : "monitoring";
  }

  // Conic ring shows warm-up progress; once active it is a solid ring in the
  // current severity color so the blob keeps reading as "alive".
  const ringPct = stopped ? 0 : isWarming ? trainingPct : 100;
  const ringBackground = `conic-gradient(${coreColor} ${ringPct}%, rgba(255,255,255,.12) 0)`;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex select-none flex-col items-end gap-2"
         style={{ fontFamily: "system-ui, sans-serif" }}>
      {expanded && (
        <ExpandedPanel>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold">Behavioral biometrics</span>
            {stopped ? (
              <button
                type="button"
                onClick={handleResume}
                className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40"
              >
                Resume
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handleReset}
                  title="Restart warm-up, keep monitoring"
                  className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleQuit}
                  title="Stop monitoring and clear stored embeddings"
                  className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-red-400/60 hover:text-red-300"
                >
                  Quit
                </button>
              </div>
            )}
          </div>
          <div className="mb-2">
            <label
              htmlFor="bio-engine"
              className="mb-1 block text-[10px] uppercase tracking-wide text-white/40"
            >
              Detection model
            </label>
            <select
              id="bio-engine"
              value={engine}
              onChange={(e) => handleEngineChange(e.target.value as MouseEngine)}
              className="w-full rounded border border-white/15 bg-[#0d1117] px-2 py-1 text-[11px] text-white/90 outline-none hover:border-white/40 focus:border-white/60"
            >
              {ENGINES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] leading-snug text-white/40">
              {ENGINES.find((e) => e.id === engine)?.blurb}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
            <dt className="text-white/50">Status</dt><dd>{phaseLabel}</dd>
            <dt className="text-white/50">Verdict</dt><dd>{data?.verdict ?? "—"}</dd>
            <dt className="text-white/50">Different user?</dt>
            <dd style={modelRisk === null ? undefined : { color: severityColor(modelRisk, threshold) }}>
              {modelRisk !== null
                ? `${Math.round(modelRisk * 100)}%`
                : mouseModule?.status === "warming"
                  ? "training…"
                  : mouseModule?.status === "error"
                    ? "failed"
                    : "—"}
            </dd>
            <dt className="text-white/50">
              {TRAINING_ENGINES.includes(engine) ? "Training data" : "Gallery"}
            </dt>
            <dd>{gallerySize} / {warmupSize}</dd>
            <dt className="text-white/50">Active modules</dt><dd>{data?.active_modules ?? 0}</dd>
            <dt className="text-white/50">Streak</dt><dd>{data?.streak ?? 0}</dd>
          </dl>
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-white/50">
              <span>Risk (last {RISK_HISTORY_LEN}s)</span>
              <span>{riskPct}%</span>
            </div>
            <RiskSparkline values={riskHistory} color={risk === null ? DIM : coreColor} />
          </div>
        </ExpandedPanel>
      )}

      <div className="flex items-center gap-2 rounded-full bg-[#161b22]/90 p-2 pl-3 shadow-xl ring-1 ring-white/10">
        <div className="w-32 overflow-hidden rounded-full bg-white/10" title="Composite detection rate">
          <div
            className="h-2 rounded-full transition-all duration-300"
            style={{ width: `${riskPct}%`, background: risk === null ? DIM : coreColor }}
          />
        </div>
        <button
          type="button"
          aria-label="Behavioral biometrics status"
          title={phaseLabel}
          onClick={() => setExpanded((v) => !v)}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-[3px] transition-transform duration-200 ${
            expanded ? "scale-110" : "scale-100"
          }`}
          style={{ background: ringBackground }}
        >
          <span
            className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-bold text-[#04121f]"
            style={{ background: coreColor }}
          >
            {unreachable ? "!" : isWarming ? `${trainingPct}` : `${riskPct}`}
          </span>
        </button>
      </div>
      <div className="pr-1 text-[11px] text-white/70">{phaseLabel}</div>
    </div>
  );
}
