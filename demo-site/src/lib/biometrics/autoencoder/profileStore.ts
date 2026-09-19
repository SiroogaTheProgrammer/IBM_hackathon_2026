/**
 * Where trained profiles live between requests. Serverless functions are
 * stateless, so a profile trained by one invocation has to be readable by the
 * next - same reasoning as src/lib/biometrics/redis.ts.
 *
 * Falls back to an in-process Map when Redis is not configured, which keeps
 * local development working without a database (profiles then die with the
 * dev server).
 */

import { getRedis } from "../redis";
import type { UserProfile } from "./types";

const KEY = (userId: string) => `ae:profile:${userId}`;
const TTL_SECONDS = 60 * 60 * 24 * 30;

const memory = new Map<string, UserProfile>();

export async function saveProfile(profile: UserProfile): Promise<void> {
  try {
    await getRedis().set(KEY(profile.userId), JSON.stringify(profile), { ex: TTL_SECONDS });
  } catch {
    memory.set(profile.userId, profile);
  }
}

export async function loadProfile(userId: string): Promise<UserProfile | null> {
  try {
    const raw = await getRedis().get<string | UserProfile>(KEY(userId));
    if (!raw) return memory.get(userId) ?? null;
    // Upstash auto-parses JSON string values on the way back out.
    return typeof raw === "string" ? (JSON.parse(raw) as UserProfile) : raw;
  } catch {
    return memory.get(userId) ?? null;
  }
}
