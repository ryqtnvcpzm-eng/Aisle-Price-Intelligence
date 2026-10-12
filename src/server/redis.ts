import "server-only";
import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

declare global {
  var __aisleRedis: Redis | undefined;
}

/** Shared Redis connection for caching. BullMQ creates its own (see monitoring/queue.ts). */
export function getRedis(): Redis {
  if (!globalThis.__aisleRedis) {
    globalThis.__aisleRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false, enableOfflineQueue: true });
    globalThis.__aisleRedis.on("error", () => {
      /* surfaced via health checks; avoid crashing the web process */
    });
  }
  return globalThis.__aisleRedis;
}

export function bullConnection() {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

/** Small JSON cache with Redis primary and in-process fallback. */
const memory = new Map<string, { value: string; expires: number }>();

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const json = JSON.stringify(value);
  try {
    await getRedis().set(key, json, "EX", ttlSeconds);
  } catch {
    memory.set(key, { value: json, expires: Date.now() + ttlSeconds * 1000 });
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const v = await getRedis().get(key);
    if (v) return JSON.parse(v) as T;
  } catch {
    /* fall through */
  }
  const m = memory.get(key);
  if (m && m.expires > Date.now()) return JSON.parse(m.value) as T;
  return null;
}
