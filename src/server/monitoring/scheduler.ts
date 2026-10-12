import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, lte, or, isNull, sql } from "drizzle-orm";
import { isMarketplaceCode } from "@/lib/marketplaces";
import { db } from "../db/client";
import { listings, monitoringJobs } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import { getProvider, type ProviderId } from "../providers";
import { checkBudget } from "./budget";
import { redisConfigured } from "../redis";
import { getQueue } from "./queue";
import { runRefreshJob } from "./refresh";

const SLOT_MS = 15 * 60_000;

export function idempotencyKey(kind: string, provider: string, marketplace: string, listingIds: string[], at: Date) {
  const digest = createHash("sha1").update([...listingIds].sort().join(",")).digest("hex").slice(0, 16);
  return `${kind}:${provider}:${marketplace}:${digest}:${Math.floor(at.getTime() / SLOT_MS)}`;
}

/**
 * Find listings due for a check, claim them (push nextCheckAt forward so the
 * next scan doesn't re-enqueue), group by provider + marketplace into
 * provider-sized batches, and enqueue one idempotent job per batch.
 */
export async function scanDueListings(now = new Date()): Promise<{ enqueued: number; listings: number; skipped: { provider: string; reason: string }[] }> {
  const due = await db
    .select({ id: listings.id, provider: listings.provider, marketplace: listings.marketplace, interval: listings.checkIntervalMinutes })
    .from(listings)
    .where(and(isNotNull(listings.checkIntervalMinutes), or(isNull(listings.nextCheckAt), lte(listings.nextCheckAt, now))))
    .orderBy(desc(listings.priority), asc(listings.nextCheckAt))
    .limit(env.MONITOR_MAX_ASINS_PER_TICK);

  const groups = new Map<string, typeof due>();
  for (const d of due) {
    const k = `${d.provider}|${d.marketplace}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }

  let enqueued = 0;
  const skipped: { provider: string; reason: string }[] = [];
  for (const [k, rows] of groups) {
    const [providerId, marketplace] = k.split("|") as [ProviderId, string];
    if (!isMarketplaceCode(marketplace)) continue;
    let provider;
    try {
      provider = getProvider(providerId);
    } catch {
      skipped.push({ provider: providerId, reason: "provider not configured" });
      continue;
    }
    if (!provider.capabilities.monitoring) {
      skipped.push({ provider: providerId, reason: "monitoring not permitted for this provider" });
      continue;
    }
    const decision = await checkBudget(providerId, rows.length);
    if (!decision.allowed) {
      skipped.push({ provider: providerId, reason: decision.reason ?? "budget" });
      // Defer rather than hammer: try again when the provider says it'll have capacity.
      const retryAt = decision.retryAt ?? new Date(now.getTime() + 60 * 60_000);
      await db.update(listings).set({ nextCheckAt: retryAt }).where(inArray(listings.id, rows.map((r) => r.id)));
      continue;
    }
    for (let i = 0; i < rows.length; i += provider.capabilities.maxBatchSize) {
      const chunk = rows.slice(i, i + provider.capabilities.maxBatchSize);
      const ids = chunk.map((c) => c.id);
      const key = idempotencyKey("scheduled", providerId, marketplace, ids, now);
      const created = await enqueueRefresh({ kind: "scheduled", provider: providerId, marketplace, listingIds: ids, key, now });
      if (created) enqueued++;
      // Claim: next check one interval from now (the job updates it again on completion).
      await db
        .update(listings)
        .set({ nextCheckAt: sql`now() + make_interval(mins => ${listings.checkIntervalMinutes})`, lastRequestedAt: now })
        .where(inArray(listings.id, ids));
    }
  }
  if (due.length) logger.info({ due: due.length, enqueued, skipped }, "monitoring scan");
  return { enqueued, listings: due.length, skipped };
}

/** Create the job row (idempotent) and hand it to the queue. Returns false for duplicates. */
export async function enqueueRefresh(opts: {
  kind: "scheduled" | "manual" | "import" | "backfill";
  provider: ProviderId;
  marketplace: string;
  listingIds: string[];
  key: string;
  now?: Date;
  workspaceId?: string;
  requestedBy?: string;
  priority?: number;
  inlineFallback?: boolean;
}): Promise<string | null> {
  const [row] = await db
    .insert(monitoringJobs)
    .values({
      kind: opts.kind,
      provider: opts.provider,
      marketplace: opts.marketplace,
      listingIds: opts.listingIds,
      idempotencyKey: opts.key,
      workspaceId: opts.workspaceId,
      requestedBy: opts.requestedBy,
      scheduledFor: opts.now ?? new Date(),
    })
    .onConflictDoNothing({ target: monitoringJobs.idempotencyKey })
    .returning({ id: monitoringJobs.id });
  if (!row) return null;
  if (!redisConfigured()) {
    // Scheduled mode: manual refreshes run immediately; scheduled ones wait for `worker:once`.
    if (opts.inlineFallback) await runRefreshJob(row.id, { attempt: 1, final: true });
    return row.id;
  }
  try {
    await getQueue().add("refresh", { jobRowId: row.id }, { jobId: opts.key.replace(/:/g, "_"), priority: opts.priority });
  } catch (e) {
    if (!opts.inlineFallback) throw e;
    // Redis unreachable (e.g. local dev without the worker): run it in-process so manual refresh still works.
    logger.warn({ err: e }, "queue unavailable; running refresh inline");
    await runRefreshJob(row.id, { attempt: 1, final: true });
  }
  return row.id;
}

export async function requestManualRefresh(opts: { workspaceId: string; userId: string; listingRows: { id: string; provider: string; marketplace: string }[] }) {
  const groups = new Map<string, string[]>();
  for (const l of opts.listingRows) groups.set(`${l.provider}|${l.marketplace}`, [...(groups.get(`${l.provider}|${l.marketplace}`) ?? []), l.id]);
  const jobIds: string[] = [];
  const now = new Date();
  for (const [k, ids] of groups) {
    const [provider, marketplace] = k.split("|") as [ProviderId, string];
    // Minute-bucketed key: double clicks dedupe, deliberate retries a minute later don't.
    const key = `manual:${provider}:${marketplace}:${createHash("sha1").update(ids.sort().join(",")).digest("hex").slice(0, 16)}:${Math.floor(now.getTime() / 60_000)}`;
    const id = await enqueueRefresh({ kind: "manual", provider, marketplace, listingIds: ids, key, now, workspaceId: opts.workspaceId, requestedBy: opts.userId, priority: 1, inlineFallback: true });
    if (id) jobIds.push(id);
  }
  return jobIds;
}

export async function jobStatuses(ids: string[], workspaceId: string) {
  if (!ids.length) return [];
  return db
    .select({ id: monitoringJobs.id, status: monitoringJobs.status, error: monitoringJobs.error, finishedAt: monitoringJobs.finishedAt, observationsWritten: monitoringJobs.observationsWritten })
    .from(monitoringJobs)
    .where(and(inArray(monitoringJobs.id, ids), eq(monitoringJobs.workspaceId, workspaceId)));
}

export async function listRecentJobs(limit = 30) {
  return db.select().from(monitoringJobs).orderBy(desc(monitoringJobs.createdAt)).limit(limit);
}

