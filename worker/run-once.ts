/**
 * One-shot monitoring pass — no Redis or long-running process required.
 * Designed for free schedulers (GitHub Actions cron, Render/Railway cron jobs):
 *
 *   pnpm worker:once            # refresh listings that are due, evaluate alerts
 *   pnpm worker:once --all      # force every monitored listing due now
 *   pnpm worker:once --daily    # also: digests, scheduled reports, retention cleanup
 */
import "dotenv/config";
process.env.AISLE_SERVICE = "worker-once";

import { inArray, isNotNull, sql } from "drizzle-orm";
import { sendDigests } from "../src/server/alerts/deliver";
import { evaluateSystemAlerts } from "../src/server/alerts/engine";
import { db, sqlClient } from "../src/server/db/client";
import { listings, monitoringJobs } from "../src/server/db/schema";
import { checkBudget } from "../src/server/monitoring/budget";
import { writeHeartbeat } from "../src/server/monitoring/heartbeat";
import { runMaintenance } from "../src/server/monitoring/maintenance";
import { processDueDeliveries } from "../src/server/notifications/email";
import { generateDueBriefings } from "../src/server/briefing/service";
import { processImportJobs } from "../src/server/catalog/bulk-import";
import { runRefreshJob } from "../src/server/monitoring/refresh";
import { idempotencyKey } from "../src/server/monitoring/scheduler";
import { getProvider, type ProviderId } from "../src/server/providers";
import { runScheduledReports } from "../src/server/reports/scheduled";

async function main() {
  const force = process.argv.includes("--all");
  const daily = process.argv.includes("--daily");
  const now = new Date();
  const due = await db
    .select({ id: listings.id, provider: listings.provider, marketplace: listings.marketplace })
    .from(listings)
    .where(force ? isNotNull(listings.checkIntervalMinutes) : sql`${listings.checkIntervalMinutes} is not null and (${listings.nextCheckAt} is null or ${listings.nextCheckAt} <= now())`);
  const groups = new Map<string, string[]>();
  for (const d of due) groups.set(`${d.provider}|${d.marketplace}`, [...(groups.get(`${d.provider}|${d.marketplace}`) ?? []), d.id]);
  let total = 0;
  for (const [k, ids] of groups) {
    const [provider, marketplace] = k.split("|") as [ProviderId, string];
    let p;
    try {
      p = getProvider(provider);
    } catch {
      console.log(`skip ${provider}/${marketplace}: provider not configured`);
      continue;
    }
    if (!p.capabilities.monitoring) {
      console.log(`skip ${provider}/${marketplace}: monitoring not permitted for this provider`);
      continue;
    }
    const budget = await checkBudget(provider, ids.length);
    if (!budget.allowed) {
      console.log(`skip ${provider}/${marketplace}: ${budget.reason}`);
      continue;
    }
    for (let i = 0; i < ids.length; i += p.capabilities.maxBatchSize) {
      const chunk = ids.slice(i, i + p.capabilities.maxBatchSize);
      const [row] = await db
        .insert(monitoringJobs)
        .values({ kind: "scheduled", provider, marketplace, listingIds: chunk, idempotencyKey: idempotencyKey("once", provider, marketplace, chunk, now) })
        .onConflictDoNothing({ target: monitoringJobs.idempotencyKey })
        .returning({ id: monitoringJobs.id });
      if (!row) continue; // another runner already took this slot
      await db.update(listings).set({ lastRequestedAt: now }).where(inArray(listings.id, chunk));
      // One attempt per run; the next scheduled run is the retry (with backoff on the listing).
      const res = await runRefreshJob(row.id, { attempt: 1, final: true }).catch((e) => ({ status: `error: ${e instanceof Error ? e.message : e}` }));
      console.log(`${provider}/${marketplace}: ${chunk.length} listings →`, res);
      total += chunk.length;
    }
  }
  await evaluateSystemAlerts();
  const imports = await processImportJobs({ maxChunks: 40, timeBudgetMs: 5 * 60_000 });
  if (imports.chunks) console.log(`bulk imports: processed ${imports.chunks} chunk(s) of up to 25 links`);
  const briefs = await generateDueBriefings(now);
  if (briefs.created) console.log(`Monday Briefing: built ${briefs.created} of ${briefs.workspaces} workspace(s)`);
  const deliveries = await processDueDeliveries(200);
  if (deliveries.attempted) console.log(`email deliveries: ${deliveries.sent} sent of ${deliveries.attempted} attempted`);
  if (daily) {
    await sendDigests("daily");
    if (now.getUTCDay() === 1) await sendDigests("weekly");
    await runScheduledReports(now);
    await runMaintenance(now);
  }
  await writeHeartbeat("scheduled", 3 * 3600);
  console.log(`✓ refreshed ${total} listing(s)${daily ? " + daily tasks" : ""}`);
  await sqlClient.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await sqlClient.end().catch(() => {});
  process.exit(1);
});
