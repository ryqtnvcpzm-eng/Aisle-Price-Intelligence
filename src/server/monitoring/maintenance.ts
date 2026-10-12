import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { activityLogs, priceObservations, providerRequests } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Retention: observations older than OBSERVATION_RETENTION_DAYS are deleted
 * (set this to whatever your provider licence allows). Request logs keep 90 days.
 */
export async function runMaintenance(now = new Date()) {
  const obsCutoff = new Date(now.getTime() - env.OBSERVATION_RETENTION_DAYS * 86_400_000);
  const logCutoff = new Date(now.getTime() - 90 * 86_400_000);
  const obs = await db.delete(priceObservations).where(lt(priceObservations.observedAt, obsCutoff)).returning({ id: priceObservations.id });
  const reqs = await db.delete(providerRequests).where(lt(providerRequests.createdAt, logCutoff)).returning({ id: providerRequests.id });
  const acts = await db.delete(activityLogs).where(lt(activityLogs.createdAt, new Date(now.getTime() - 365 * 86_400_000))).returning({ id: activityLogs.id });
  await db.execute(sql`analyze price_observations`);
  logger.info({ observations: obs.length, requests: reqs.length, activity: acts.length }, "maintenance complete");
  return { observations: obs.length, requests: reqs.length };
}
