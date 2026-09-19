/**
 * Upstash Redis client for per-session state. Vercel KV (the old first-party
 * product) is deprecated as of December 2024 - existing stores were migrated
 * to Upstash Redis, and new projects provision a database through the
 * Marketplace "Upstash for Redis" integration instead (project's Storage tab
 * -> Marketplace -> Upstash for Redis -> create/link a database). That
 * integration injects `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
 * into the linked Vercel project automatically. For local dev, copy those
 * two values into `demo-site/.env.local`.
 */

import { Redis } from "@upstash/redis";

/** The subset of the Upstash client this codebase actually uses. */
type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

let client: RedisLike | null = null;

/**
 * Process-local stand-in used only when no database is configured *in
 * development*, so the demo runs from a fresh clone without provisioning
 * Upstash first. It is deliberately not used in production: serverless
 * instances do not share memory, so silently falling back there would make a
 * misconfigured deployment look like it worked while sessions randomly lost
 * their gallery depending on which instance served the tick.
 */
function inMemoryRedis(): RedisLike {
  const store = new Map<string, { value: string; expiresAt: number }>();

  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  return {
    async get<T>(key: string) {
      const entry = live(key);
      // Round-trip through JSON like the real client, so callers that mutate
      // what they read cannot reach back into stored state.
      return entry ? (JSON.parse(entry.value) as T) : null;
    },
    async set(key, value, opts) {
      store.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + (opts?.ex ?? 1800) * 1000,
      });
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

/** Lazily construct the client so a missing/unconfigured database only
 * breaks the specific API request that needs it - not `next build`, and not
 * unrelated routes/pages. */
export function getRedis(): RedisLike {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[biometrics] No Redis configured - using an in-memory store for this dev " +
          "process. Session state is lost on restart. Set UPSTASH_REDIS_REST_URL / " +
          "UPSTASH_REDIS_REST_TOKEN in demo-site/.env.local to use a real database.",
      );
      client = inMemoryRedis();
      return client;
    }
    throw new Error(
      "No Redis database connected. In the Vercel dashboard, open this project's " +
        "Storage tab and add a Redis integration (Marketplace -> Upstash for Redis), " +
        "or set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in demo-site/.env.local " +
        "for local development.",
    );
  }

  client = new Redis({ url, token });
  return client;
}
