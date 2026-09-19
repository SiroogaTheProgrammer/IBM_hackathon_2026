# MyCourses clone (demo-site)

A static, visually faithful clone of [Aalto MyCourses](https://mycourses.aalto.fi) (Moodle),
built as the stimulus site for a mouse-movement / behavioural-biometrics data-collection study.

Every page is static data under `src/data/` — the point is that the chrome is navigable and
genuinely interactive — dropdowns open, drawers collapse, tabs switch, filters filter — so that
recorded pointer traces look like real browsing.

This is now the **primary test site**: a floating widget (`src/components/BiometricsWidget.tsx`),
mounted once in the root layout so it survives client-side navigation, captures mouse, keystroke
and route-navigation telemetry from every page and streams it to `/api/biometrics/*`. That risk
engine runs **natively in this site's own Next.js Route Handlers** (`src/app/api/biometrics/`,
backed by TypeScript ports of the Python model under `src/lib/biometrics/`) — there is no separate
Python server to run in production. Per-session state (embedding gallery, fitted risk model,
streak/escalation, tab-nav/keystroke baselines) lives in an Upstash Redis database between
requests, since serverless functions are stateless.

The original `../demo/server.py` + `python run_demo.py` still exist and still work standalone (the
plain-HTML local demo, no Next.js) — they're just no longer what this site talks to.

## Getting started

### 1. Provision a Redis database (once per Vercel project)

Vercel's own KV product is deprecated; new projects use the Marketplace **Upstash for Redis**
integration instead:

1. Open this project in the Vercel dashboard → **Storage** tab → **Marketplace** → **Upstash for
   Redis** → create (or link an existing) database, then connect it to this project.
2. That injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` into the project's
   environment variables automatically — no further Vercel-side setup needed.
3. For local development, copy those two values (Vercel dashboard → Settings → Environment
   Variables, or the Upstash console) into a `demo-site/.env.local`:

   ```bash
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   ```

   (If your project's env vars ended up under different names, e.g. legacy `KV_REST_API_URL` /
   `KV_REST_API_TOKEN` from a migrated Vercel KV store, `src/lib/biometrics/redis.ts` already
   reads either pair.)

### 2. Run the site

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # must pass with zero TypeScript / ESLint errors
npm run lint
```

The floating widget in the bottom-right corner shows a ring for baseline warm-up progress (first
~60 windows) and a bar for the live composite detection rate once the session goes active. If
`/api/biometrics/*` errors out (e.g. no Redis database connected yet), it just shows
"backend offline" and the site otherwise works normally.

### Re-exporting the mouse model

`src/lib/biometrics/model/*.json` (encoder weights, feature scaler, background embedding sample)
are generated from the trained PyTorch artifacts by `export_web_model.py` at the repo root. Re-run
it after retraining:

```bash
python export_web_model.py   # from the repo root
```

### Scope of this serverless port

- **Mouse module**: full port — 32-feature extractor, frozen encoder forward pass, feature
  scaler, and a per-session risk classifier.
- **Tab navigation module**: full port (pure statistics, no ML).
- **Keystroke module**: uses only the *legacy* pure z-score fallback logic from the Python module
  (the same fallback the local demo itself uses before `train_keystroke_model.py` has been run) —
  not the pretrained-embedding path, to avoid exporting/bundling a second neural net.
- **Device/env module**: skipped (disabled by default in `addons.json` too).
- **Per-user classifier**: the Python side's per-session LightGBM classifier is replaced with a
  small logistic regression trained via gradient descent on the same 7 distance-stat features —
  LightGBM's native dependency is too heavy for a Vercel function.



## Routes

| Route | Page |
|---|---|
| `/` | Front page — banner, `Home` / `Course feedback` tabs, News + For Students blocks |
| `/my` | Dashboard — Timeline block, Recently accessed courses, Upcoming events drawer |
| `/my/courses` | My own courses — filter / search / sort, four course rows |
| `/user/profile` | Profile — user details, badges, course details, mobile app |
| `/course/40011` | CS-E9410 Foundations of Pattern Discovery |
| `/course/40012` | CS-E9620 Visual Computing Systems |
| `/course/40013` | ELEC-E9130 Adaptive Control and Decision Making |
| `/course/40014` | ELEC-E9740 Principles of Signal Estimation |
| `/mod/<type>/<id>` | Activity pages — `assign` / `quiz` / `forum` / `feedback` |
| `/calendar/event/<id>` | Calendar session and deadline pages |

Any other `/course/<id>` returns 404, as does a `/mod/<type>/<id>` whose type does not
match the module id. Every course, person, venue and reading in `src/data/` is invented.

## Layout

```
src/app/         routes (server components unless they own interactive state)
src/app/api/biometrics/
                 tick / config / reset Route Handlers - the serverless risk engine's HTTP surface
src/components/  shared chrome — Navbar, Footer, Dropdown, BlockDrawer, SafeLink, …
src/data/        all static content: site.ts (nav/menus/assets), courses.ts, news.ts, …
src/lib/biometrics/
                 ported encoder/scaler/risk-model/tab-nav/keystroke/composite logic + Redis session store
src/app/globals.css
                 the `.mc-*` design system, measured from the live site
```

## Conventions

- **Design tokens live in `globals.css`** as `--mc-*` custom properties and `.mc-*` classes,
  measured from the real site. Tailwind v4 is available for incidental layout only; don't
  re-theme with utilities.
- **No `next/image` for the remote `mycourses.aalto.fi` theme assets** — there is no
  remote-pattern config. Use plain `<img>` or a CSS `background-image`, always with a
  background-color fallback.
- **Icons are inline SVG** (`src/components/Icons.tsx`). No icon CDN, no icon font.
- **`"use client"` only for real interactivity.** Pass server-rendered markup into client
  components as `ReactNode` props (see `HomeTabs`) so content stays out of the client bundle.
- **Links go through `SafeLink`.** It routes `/…` through `next/link`, opens `http(s)` in a new
  tab, and makes placeholder `#` targets clickable but inert — a bare `#` would jump the page to
  the top and pollute the recording.
- Strict TypeScript: no `any`, no unused symbols, apostrophes escaped in JSX text.
