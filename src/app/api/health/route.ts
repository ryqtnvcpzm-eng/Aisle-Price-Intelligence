import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { HEARTBEAT_KEY } from "@/server/monitoring/queue";
import { getRedis } from "@/server/redis";

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
  try {
    const hb = await getRedis().get(HEARTBEAT_KEY);
    out.redis = "ok";
    out.worker = hb ? "alive" : "no heartbeat";
  } catch {
    out.redis = "down";
  }
  return Response.json(out, { status: out.ok ? 200 : 503 });
}
