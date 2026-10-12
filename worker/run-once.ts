/**
 * One-shot monitoring pass without Redis/BullMQ: claim due listings and run
 * their refresh batches in-process. Useful for cron-only hosts and for tests.
 *   pnpm worker:once            # due listings only
 *   pnpm worker:once --all      # force every monitored listing due now
 */
import "dotenv/config";
import { inArray, isNotNull, sql } from "drizzle-orm";
import { db, sqlClient } from "../src/server/db/client";
import { listings, monitoringJobs } from "../src/server/db/schema";
import { runRefreshJob } from "../src/server/monitoring/refresh";
import { idempotencyKey } from "../src/server/monitoring/scheduler";

async function main() {
  const force = process.argv.includes("--all");
  const now = new Date();
  const due = await db
    .select({ id: listings.id, provider: listings.provider, marketplace: listings.marketplace })
    .from(listings)
    .where(force ? isNotNull(listings.checkIntervalMinutes) : sql`${listings.checkIntervalMinutes} is not null and (${listings.nextCheckAt} is null or ${listings.nextCheckAt} <= now())`);
  const groups = new Map<string, string[]>();
  for (const d of due) groups.set(`${d.provider}|${d.marketplace}`, [...(groups.get(`${d.provider}|${d.marketplace}`) ?? []), d.id]);
  let total = 0;
  for (const [k, ids] of groups) {
    const [provider, marketplace] = k.split("|") as [string, string];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const [row] = await db
        .insert(monitoringJobs)
        .values({ kind: "manual", provider, marketplace, listingIds: chunk, idempotencyKey: `${idempotencyKey("once", provider, marketplace, chunk, now)}:${Date.now()}` })
        .returning({ id: monitoringJobs.id });
      await db.update(listings).set({ lastRequestedAt: now }).where(inArray(listings.id, chunk));
      const res = await runRefreshJob(row!.id, { attempt: 1, final: true });
      console.log(`${provider}/${marketplace}: ${chunk.length} listings →`, res);
      total += chunk.length;
    }
  }
  console.log(`✓ refreshed ${total} listing(s)`);
  await sqlClient.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await sqlClient.end().catch(() => {});
  process.exit(1);
});
