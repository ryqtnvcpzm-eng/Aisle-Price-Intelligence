import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { readHeartbeat } from "@/server/monitoring/heartbeat";
import { getRedis, redisConfigured } from "@/server/redis";

/** Liveness/readiness for the platform: database, Redis, and worker heartbeat. No secrets. */
export async function GET() {
  const out: Record<string, unknown> = { ok: true };
  try {
    await db.execute(sql`select 1`);
    out.database = "ok";
  } catch {
    out.database = "down";
    out.ok = false;
  }
  if (redisConfigured()) {
    try {
      await getRedis().ping();
      out.redis = "ok";
    } catch {
      out.redis = "down";
    }
  } else out.redis = "not configured (scheduled mode)";
  const hb = await readHeartbeat();
  out.worker = hb ? { mode: hb.mode, lastSeen: hb.at } : "no heartbeat";
  return Response.json(out, { status: out.ok ? 200 : 503 });
}
