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

let client: Redis | null = null;

/** Lazily construct the client so a missing/unconfigured database only
 * breaks the specific API request that needs it - not `next build`, and not
 * unrelated routes/pages. */
export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
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
