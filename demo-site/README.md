# MyCourses clone (demo-site)

A static, visually faithful clone of [Aalto MyCourses](https://mycourses.aalto.fi) (Moodle),
built as the stimulus site for a mouse-movement / behavioural-biometrics data-collection study.

There is **no backend**. Every page is static data under `src/data/`. The point is that the
chrome is navigable and genuinely interactive — dropdowns open, drawers collapse, tabs switch,
filters filter — so that recorded pointer traces look like real browsing.

## Getting started

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # must pass with zero TypeScript / ESLint errors
npm run lint
```

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
src/components/  shared chrome — Navbar, Footer, Dropdown, BlockDrawer, SafeLink, …
src/data/        all static content: site.ts (nav/menus/assets), courses.ts, news.ts, …
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
