"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
const API_BASE = "/api/biometrics";
const DIM = "#8b949e";
const OK = "#3fb950";
const WARN = "#d29922";
const BAD = "#f85149";

function severityColor(risk: number, threshold: number): string {
  if (risk >= threshold) return BAD;
  if (risk >= threshold * 0.7) return WARN;
  return OK;
}

export default function BiometricsWidget() {
  const pathname = usePathname();
  const [data, setData] = useState<TickResponse | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: "NoButton", state: buttonDown.current ? "Drag" : "Move",
      });
    };
    const onDown = (e: MouseEvent) => {
      buttonDown.current = true;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: e.button === 2 ? "Right" : "Left", state: "Pressed",
      });
    };
    const onUp = (e: MouseEvent) => {
      buttonDown.current = false;
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: e.button === 2 ? "Right" : "Left", state: "Released",
      });
    };
    const onWheel = (e: WheelEvent) => {
      mouseBuf.current.push({
        t: stamp(), x: e.clientX, y: e.clientY,
        button: "Scroll", state: e.deltaY < 0 ? "Up" : "Down",
      });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (keyDownAt.current[e.key] === undefined) keyDownAt.current[e.key] = stamp();
    };
    const onKeyUp = (e: KeyboardEvent) => {
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
      const payload = {
        events: mouseBuf.current,
        nav: navBuf.current,
        keys: keyBuf.current,
        device: { blur_count: 0, resize_count: 0, screen: `${window.screen.width}x${window.screen.height}` },
      };
      mouseBuf.current = [];
      navBuf.current = [];
      keyBuf.current = [];

      try {
        const res = await fetch(`${API_BASE}/tick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as TickResponse);
        setUnreachable(false);
      } catch {
        setUnreachable(true);
      }
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const handleReset = async () => {
    try {
      await fetch(`${API_BASE}/reset`, { method: "POST" });
      setData(null);
    } catch {
      setUnreachable(true);
    }
  };

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
  if (unreachable) {
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
  const ringPct = isWarming ? trainingPct : 100;
  const ringBackground = `conic-gradient(${coreColor} ${ringPct}%, rgba(255,255,255,.12) 0)`;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex select-none flex-col items-end gap-2"
         style={{ fontFamily: "system-ui, sans-serif" }}>
      {expanded && (
        <div className="mb-1 w-60 rounded-lg border border-white/10 bg-[#161b22] p-3 text-[12px] text-[#e6edf3] shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">Behavioral biometrics</span>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-white/15 px-2 py-0.5 text-[11px] hover:border-white/40"
            >
              Reset
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
            <dt className="text-white/50">Status</dt><dd>{phaseLabel}</dd>
            <dt className="text-white/50">Verdict</dt><dd>{data?.verdict ?? "—"}</dd>
            <dt className="text-white/50">Gallery</dt><dd>{gallerySize} / {warmupSize}</dd>
            <dt className="text-white/50">Active modules</dt><dd>{data?.active_modules ?? 0}</dd>
            <dt className="text-white/50">Streak</dt><dd>{data?.streak ?? 0}</dd>
          </dl>
        </div>
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
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-[3px]"
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
