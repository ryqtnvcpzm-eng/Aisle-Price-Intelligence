import "server-only";
import { cacheGet, cacheSet, getRedis, redisConfigured } from "../redis";
import { HEARTBEAT_KEY } from "./queue";

export interface Heartbeat {
  at: string;
  pid?: number;
  mode: "queue" | "scheduled";
}

/** The queue worker beats every 30s; the scheduled runner (`worker:once`) records each run. */
export async function writeHeartbeat(mode: Heartbeat["mode"], ttlSeconds: number) {
  const hb: Heartbeat = { at: new Date().toISOString(), pid: process.pid, mode };
  if (redisConfigured() && mode === "queue") await getRedis().set(HEARTBEAT_KEY, JSON.stringify(hb), "EX", ttlSeconds);
  else await cacheSet(HEARTBEAT_KEY, hb, ttlSeconds);
}

export async function readHeartbeat(): Promise<Heartbeat | null> {
  try {
    if (redisConfigured()) {
      const raw = await getRedis().get(HEARTBEAT_KEY);
      if (raw) return JSON.parse(raw) as Heartbeat;
    }
    return await cacheGet<Heartbeat>(HEARTBEAT_KEY);
  } catch {
    return null;
  }
}
