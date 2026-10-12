import "server-only";
import { eq, lt } from "drizzle-orm";
import IORedis, { type Redis } from "ioredis";
import { db } from "./db/client";
import { cacheEntries } from "./db/schema";
import { env } from "./env";

declare global {
  var __aisleRedis: Redis | undefined;
}

/** Redis is optional: with it, BullMQ runs the worker queue; without it, Postgres backs the cache. */
export function redisConfigured() {
  return Boolean(env.REDIS_URL);
}

export function getRedis(): Redis {
  if (!env.REDIS_URL) throw new Error("REDIS_URL is not configured");
  if (!globalThis.__aisleRedis) {
    globalThis.__aisleRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: true });
    globalThis.__aisleRedis.on("error", () => {
      /* surfaced via health checks; avoid crashing the web process */
    });
  }
  return globalThis.__aisleRedis;
}

export function bullConnection() {
  if (!env.REDIS_URL) throw new Error("REDIS_URL is required for the queue worker. Use `pnpm worker:once` on a schedule instead.");
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

/** Small JSON cache: Redis when configured, otherwise a Postgres table (works across serverless instances). */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  if (redisConfigured()) {
    try {
      await getRedis().set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    } catch {
      /* fall back to Postgres */
    }
  }
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.insert(cacheEntries).values({ key, value: value as object, expiresAt }).onConflictDoUpdate({ target: cacheEntries.key, set: { value: value as object, expiresAt } });
  // Opportunistic cleanup keeps the table tiny.
  if (Math.random() < 0.05) await db.delete(cacheEntries).where(lt(cacheEntries.expiresAt, new Date()));
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redisConfigured()) {
    try {
      const v = await getRedis().get(key);
      if (v) return JSON.parse(v) as T;
    } catch {
      /* fall through */
    }
  }
  const [row] = await db.select().from(cacheEntries).where(eq(cacheEntries.key, key));
  if (!row || row.expiresAt < new Date()) return null;
  return row.value as T;
}
