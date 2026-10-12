import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { isMarketplaceCode } from "@/lib/marketplaces";
import { formatMoney, formatPct } from "@/lib/money";
import { logActivity } from "../activity";
import { evaluateAlertsForListings } from "../alerts/engine";
import { writeObservation } from "../catalog/persist";
import { db } from "../db/client";
import { listings, monitoringJobs, productFamilies, variants } from "../db/schema";
import { logger } from "../logger";
import { getProvider, ProviderError, type ProviderId } from "../providers";
import { pauseProvider } from "./budget";

export interface RunOptions {
  attempt: number;
  /** True on the last allowed attempt: failures are final, not retried. */
  final: boolean;
}

/**
 * Execute one refresh batch. Idempotent: observations are unique on
 * (listing, observedAt, provider), and a job that already succeeded is a no-op.
 * Throws retryable ProviderErrors so BullMQ applies exponential backoff.
 */
export async function runRefreshJob(jobRowId: string, opts: RunOptions) {
  const [job] = await db.select().from(monitoringJobs).where(eq(monitoringJobs.id, jobRowId));
  if (!job) return { status: "missing" as const };
  if (job.status === "succeeded" || job.status === "skipped") return { status: job.status };
  if (!isMarketplaceCode(job.marketplace)) {
    await db.update(monitoringJobs).set({ status: "failed", error: "unknown marketplace", finishedAt: new Date() }).where(eq(monitoringJobs.id, job.id));
    return { status: "failed" as const };
  }
  const startedAt = new Date();
  await db.update(monitoringJobs).set({ status: "running", startedAt, attempts: opts.attempt }).where(eq(monitoringJobs.id, job.id));

  const rows = await db.select({ id: listings.id, asin: listings.asin, status: listings.status }).from(listings).where(inArray(listings.id, job.listingIds));
  if (!rows.length) {
    await db.update(monitoringJobs).set({ status: "skipped", finishedAt: new Date(), error: "no listings" }).where(eq(monitoringJobs.id, job.id));
    return { status: "skipped" as const };
  }
  const provider = getProvider(job.provider as ProviderId);
  const byAsin = new Map(rows.map((r) => [r.asin, r]));

  let batch;
  try {
    batch = await provider.getProducts(job.marketplace, rows.map((r) => r.asin));
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError("upstream", e instanceof Error ? e.message : "unknown error");
    if (err.kind === "quota_exhausted" || err.kind === "rate_limited") {
      await pauseProvider(provider.id, new Date(Date.now() + (err.opts.retryAfterMs ?? 60_000)));
    }
    const failFinal = opts.final || !err.retryable;
    await db
      .update(listings)
      .set({
        lastFailureAt: new Date(),
        lastError: err.userMessage,
        consecutiveFailures: sql`${listings.consecutiveFailures} + 1`,
        // Exponential backoff for this listing's next scheduled try, capped at 12h.
        ...(failFinal ? { nextCheckAt: sql`now() + make_interval(mins => least(720, coalesce(${listings.checkIntervalMinutes}, 60) * power(2, least(${listings.consecutiveFailures}, 4))::int))` } : {}),
      })
      .where(inArray(listings.id, job.listingIds));
    await db.update(monitoringJobs).set({ status: failFinal ? "failed" : "queued", error: err.userMessage, finishedAt: failFinal ? new Date() : null }).where(eq(monitoringJobs.id, job.id));
    logger.warn({ job: job.id, kind: err.kind, attempt: opts.attempt, final: failFinal }, "refresh failed");
    if (failFinal) {
      await evaluateAlertsForListings(job.listingIds, { trigger: "failure" }).catch((x) => logger.error({ err: x }, "alert evaluation failed"));
      return { status: "failed" as const };
    }
    throw err;
  }

  let written = 0;
  const changes: { listingId: string; from: number | null; to: number | null; currency: string; availabilityChanged: boolean; to_avail: string }[] = [];
  const now = new Date();
  for (const product of batch.products) {
    const row = byAsin.get(product.asin);
    if (!row) continue;
    await db
      .update(listings)
      .set({
        status: product.status,
        providerUpdatedAt: product.providerUpdatedAt,
        lastSuccessAt: now,
        lastRequestedAt: batch.requestedAt,
        consecutiveFailures: 0,
        lastError: null,
        title: product.title ?? sql`${listings.title}`,
        imageUrl: product.imageUrl ?? sql`${listings.imageUrl}`,
        nextCheckAt: sql`now() + make_interval(mins => coalesce(${listings.checkIntervalMinutes}, 60))`,
      })
      .where(eq(listings.id, row.id));
    if (!product.snapshot) continue;
    const res = await writeObservation(db, row.id, job.marketplace, product.snapshot, {
      provider: provider.id,
      source: "poll",
      requestedAt: batch.requestedAt,
      providerUpdatedAt: product.providerUpdatedAt,
      isSimulated: product.isSimulated,
    });
    if (res.inserted) written++;
    const availabilityChanged = res.previousAvailability !== null && res.previousAvailability !== product.snapshot.availability;
    if (res.changed || availabilityChanged) {
      changes.push({ listingId: row.id, from: res.previousPriceMinor, to: product.snapshot.priceMinor, currency: product.snapshot.currency, availabilityChanged, to_avail: product.snapshot.availability });
    }
  }
  for (const asin of batch.missing) {
    const row = byAsin.get(asin);
    if (!row) continue;
    await db
      .update(listings)
      .set({ status: "not_found", lastFailureAt: now, lastError: "The provider no longer returns this listing.", consecutiveFailures: sql`${listings.consecutiveFailures} + 1` })
      .where(eq(listings.id, row.id));
  }

  const status = batch.missing.length && batch.products.length ? "partial" : batch.products.length ? "succeeded" : "failed";
  await db
    .update(monitoringJobs)
    .set({ status, finishedAt: new Date(), observationsWritten: written, tokensUsed: batch.tokensConsumed ?? 0, error: batch.missing.length ? `${batch.missing.length} listing(s) not returned` : null })
    .where(eq(monitoringJobs.id, job.id));

  await recordChangeActivity(changes, provider.isSimulated);
  await evaluateAlertsForListings(job.listingIds, { trigger: "refresh" }).catch((e) => logger.error({ err: e }, "alert evaluation failed"));
  return { status, written, changes: changes.length };
}

/** Write per-workspace activity for observed price/stock changes. */
async function recordChangeActivity(changes: { listingId: string; from: number | null; to: number | null; currency: string; availabilityChanged: boolean; to_avail: string }[], simulated: boolean) {
  if (!changes.length) return;
  const tracked = await db
    .select({ workspaceId: variants.workspaceId, variantId: variants.id, listingId: variants.listingId, label: variants.label, familyTitle: productFamilies.title, familyId: productFamilies.id })
    .from(variants)
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .where(inArray(variants.listingId, changes.map((c) => c.listingId)));
  for (const c of changes) {
    for (const t of tracked.filter((x) => x.listingId === c.listingId)) {
      const name = `${t.familyTitle.split(",")[0]} · ${t.label}`;
      let message: string;
      let kind: string;
      if (c.availabilityChanged && c.to_avail === "out_of_stock") {
        kind = "stock_out";
        message = `${name} became unavailable`;
      } else if (c.availabilityChanged && c.to_avail === "in_stock" && c.from === null) {
        kind = "stock_in";
        message = `${name} is back in stock at ${formatMoney(c.to, c.currency)}`;
      } else if (c.from !== null && c.to !== null) {
        const r = (c.to - c.from) / c.from;
        kind = r < 0 ? "price_down" : "price_up";
        message = `${name} ${r < 0 ? "dropped" : "rose"} ${formatPct(Math.abs(r))} to ${formatMoney(c.to, c.currency)}`;
      } else continue;
      await logActivity({ workspaceId: t.workspaceId, kind, message, entityType: "family", entityId: t.familyId, metadata: { variantId: t.variantId, from: c.from, to: c.to, currency: c.currency }, isSimulated: simulated });
    }
  }
}
