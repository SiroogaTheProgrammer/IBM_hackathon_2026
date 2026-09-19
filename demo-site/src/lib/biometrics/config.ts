/**
 * Static configuration mirroring `addons.json` at the repo root. Kept as a
 * plain TS module (rather than reading the JSON file at request time) since
 * Vercel functions don't have access to the rest of the repo - if you change
 * `addons.json`, mirror the change here too.
 */

export const ADDON_CONFIG = {
  modules: {
    mouse_base_v1: { weight: 1.0, hardTrigger: null as number | null, isBase: true, displayName: "Mouse / pointer dynamics (base)" },
    tab_navigation_v1: { weight: 0.6, hardTrigger: 0.95 as number | null, isBase: false, displayName: "Tab navigation path" },
    keystroke_v1: { weight: 0.5, hardTrigger: null as number | null, isBase: false, displayName: "Keystroke dynamics" },
  },
  session: {
    warmup_size: 60,
    gallery_mode: "frozen",
    smoothing: 5,
    threshold: 0.8,
    cycles: 3,
  },
};

export const BACKGROUND_SIZE = 150;
export const TARGET_FALSE_ALARM = 0.05;
