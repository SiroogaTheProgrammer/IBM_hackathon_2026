"""Local demo server for the continuous behavioral biometrics system.

Standard library only - no extra dependencies. The browser captures raw
mouse/key/navigation events, posts a batch every 1 s, and the server runs the
composite risk engine and returns the numbers the dashboard draws.

    python run_demo.py

Binds to 127.0.0.1 only. This is a local demo, not a production service:
there is a single in-memory session and no authentication.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

IDLE_ACTIVITY_THRESHOLD = 0.18  # treat a 1 s tick as idle if motion is too small
IDLE_MAX_EVENT_COUNT = 2

DEMO_DIR = Path(__file__).resolve().parent
INDEX_FILE = DEMO_DIR / "index.html"
MAX_BODY_BYTES = 1_000_000  # a 1 s mouse batch is a few KB; cap well above that

_engine = None
_lock = threading.Lock()


def _is_idle_tick(payload: dict) -> bool:
    """True when there is nothing worth scoring in this tick.

    Only mouse motion used to gate this used to drop the *entire* payload,
    including keystroke and tab-navigation telemetry, whenever the mouse did
    not move - but typing or switching tabs without also wiggling the mouse
    is completely normal, and doing so silently starved the keystroke and
    tab-navigation extensions of data. Any non-trivial key or nav activity
    keeps the tick alive regardless of mouse movement.
    """
    if payload.get("keys") or payload.get("nav"):
        return False

    events = payload.get("events", [])
    if len(events) > IDLE_MAX_EVENT_COUNT:
        return False
    if not events:
        return True

    total_distance = 0.0
    for item in events:
        try:
            x = float(item.get("x", 0.0))
            y = float(item.get("y", 0.0))
            total_distance += abs(x) + abs(y)
        except (TypeError, ValueError):
            continue
    return total_distance <= IDLE_ACTIVITY_THRESHOLD


class DemoHandler(BaseHTTPRequestHandler):
    server_version = "BehavioralBiometricsDemo/1.0"

    def do_GET(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        # Only two fixed routes are served; no path is ever joined with user
        # input, so directory traversal is not reachable.
        if self.path in ("/", "/index.html"):
            self._send_bytes(INDEX_FILE.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/config":
            self._send_json(self._config_payload())
        else:
            self._send_json({"error": "not found"}, status=404)

    def do_POST(self):  # noqa: N802
        if self.path == "/api/tick":
            payload = self._read_json()
            if payload is None:
                return
            if _is_idle_tick(payload):
                self._send_json({
                    "idle": True,
                    "composite_risk": 0.0,
                    "verdict": "IDLE",
                    "modules": [],
                    "session": {"status": "idle", "gallery_size": 0, "warmup_size": 0, "gallery_mode": ""},
                    "threshold": 0.8,
                    "streak": 0,
                    "active_modules": 0,
                    "escalated": False,
                })
                return
            with _lock:
                result = _engine.update(payload)
                session = getattr(_engine, "session", None)
                response = result.to_dict()
                response["session"] = {
                    "status": session.status if session else "unknown",
                    "gallery_size": len(session.embeddings) if session else 0,
                    "warmup_size": session.warmup_size if session else 0,
                    "gallery_mode": session.gallery_mode if session else "",
                }
            self._send_json(response)
        elif self.path == "/api/reset":
            with _lock:
                _engine.reset()
            self._send_json({"ok": True})
        else:
            self._send_json({"error": "not found"}, status=404)

    # -- helpers ----------------------------------------------------------
    def _config_payload(self) -> dict:
        with _lock:
            session = getattr(_engine, "session", None)
            return {
                "modules": _engine.describe(),
                "threshold": _engine.threshold,
                "cycles": _engine.cycles,
                "warmup_size": session.warmup_size if session else 0,
                "gallery_mode": session.gallery_mode if session else "",
                "smoothing": session.smoothing if session else 0,
            }

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self._send_json({"error": "bad content length"}, status=400)
            return None
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json({"error": "invalid body size"}, status=413)
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json({"error": "invalid json"}, status=400)
            return None

    def _send_json(self, payload: dict, status: int = 200):
        self._send_bytes(
            json.dumps(payload).encode("utf-8"), "application/json", status=status
        )

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/api/tick" not in (args[0] if args else ""):
            super().log_message(fmt, *args)


def serve(engine, host: str = "127.0.0.1", port: int = 8000) -> None:
    global _engine
    _engine = engine

    httpd = ThreadingHTTPServer((host, port), DemoHandler)
    print(f"\n  Demo running at  http://{host}:{port}")
    print("  Move the mouse in the dashboard to start the 60 s warm-up.")
    print("  Press Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()
