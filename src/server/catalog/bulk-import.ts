import "server-only";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { listingKey, parseProductInput } from "@/lib/amazon-url";
import { isMarketplaceCode, listingUrl, type MarketplaceCode } from "@/lib/marketplaces";
import { logActivity } from "../activity";
import { resolveShortLink } from "../amazon/resolve";
import { reconcileAfterChange } from "../brand/hooks";
import { db } from "../db/client";
import { comparisonGroups, importJobItems, importJobs, listings, user, variants, workspaceMembers, workspaces, type ImportJob, type ImportJobOptions } from "../db/schema";
import { HttpError } from "../errors";
import { logger } from "../logger";
import { checkBudget } from "../monitoring/budget";
import { getActiveProvider } from "../providers";
import type { AppContext } from "../workspace/context";
import { commitImport, previewImport } from "./import";

/**
 * Queued bulk import: any number of links, processed 25 at a time.
 *
 * The job and every link are rows, so progress survives a closed tab, a
 * redeploy or a crashed worker. Whoever is around drives it — the open
 * progress page, the queue worker, or the cron run — and a short lease stops
 * two of them working on the same job at once. Each link ends as succeeded,
 * skipped (with the reason) or failed (with the reason); transient provider
 * errors go back in the queue a few times before failing.
 */
export const CHUNK_SIZE = 25;
/** A safety limit per job (a plain-text request of this size is ~1 MB); bigger lists can be split across jobs. */
export const MAX_ITEMS_PER_JOB = 20_000;
const LEASE_MS = 2 * 60_000;
const STUCK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set(["rate_limited", "timeout", "upstream", "quota_exhausted", "provider_error"]);

export const createJobSchema = z.object({
  inputs: z.array(z.string().trim().min(1).max(2048)).min(1).max(MAX_ITEMS_PER_JOB),
  variantPolicy: z.enum(["pasted_only", "all_variants"]).default("pasted_only"),
  intervalMinutes: z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440), z.null()]).default(60),
  groupId: z.string().uuid().nullable().optional(),
  marketplace: z.string().refine(isMarketplaceCode).optional(),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export async function createImportJob(ctx: AppContext, input: CreateJobInput) {
  const defaultMarketplace: MarketplaceCode = input.marketplace && isMarketplaceCode(input.marketplace) ? input.marketplace : isMarketplaceCode(ctx.workspace.defaultMarketplace) ? ctx.workspace.defaultMarketplace : "IN";
  if (input.groupId) {
    const [g] = await db.select({ id: comparisonGroups.id, managedBy: comparisonGroups.managedBy }).from(comparisonGroups).where(and(eq(comparisonGroups.id, input.groupId), eq(comparisonGroups.workspaceId, ctx.workspace.id)));
    if (!g) throw new HttpError(404, "Comparison not found.");
    if (g.managedBy) throw new HttpError(409, "Products join managed comparisons automatically. Choose another comparison or none.");
  }
  const seen = new Map<string, number>();
  const items = input.inputs.map((raw, position) => {
    const p = parseProductInput(raw, defaultMarketplace);
    if (p.kind === "error") return { position, input: raw.slice(0, 2048), marketplace: null, asin: null, status: "failed" as const, errorCode: p.code, error: p.message };
    if (p.kind === "short_link") return { position, input: raw, marketplace: p.marketplaceHint, asin: null, status: "pending" as const, errorCode: null, error: null };
    const key = listingKey(p.marketplace, p.asin);
    const dup = seen.get(key);
    if (dup !== undefined) return { position, input: raw, marketplace: p.marketplace, asin: p.asin, status: "skipped" as const, errorCode: "duplicate", error: `Same listing as row ${dup + 1}` };
    seen.set(key, position);
    return { position, input: raw, marketplace: p.marketplace, asin: p.asin, status: "pending" as const, errorCode: null, error: null };
  });
  const provider = getActiveProvider();
  const options: ImportJobOptions = { variantPolicy: input.variantPolicy, intervalMinutes: input.intervalMinutes, groupId: input.groupId ?? null, defaultMarketplace };
  const job = await db.transaction(async (tx) => {
    const [j] = await tx.insert(importJobs).values({ workspaceId: ctx.workspace.id, createdBy: ctx.user.id, total: items.length, options, isSimulated: provider.isSimulated }).returning();
    for (let i = 0; i < items.length; i += 1000) await tx.insert(importJobItems).values(items.slice(i, i + 1000).map((it) => ({ ...it, jobId: j!.id })));
    return j!;
  });
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "bulk_import", message: `Queued a bulk import of ${items.length.toLocaleString("en-IN")} link${items.length === 1 ? "" : "s"}`, entityType: "import_job", entityId: job.id, isSimulated: provider.isSimulated });
  return job;
}

export interface JobCounts {
  pending: number;
  processing: number;
  succeeded: number;
  skipped: number;
  failed: number;
  cancelled: number;
  variantsAdded: number;
}

export async function jobCounts(jobId: string): Promise<JobCounts> {
  const rows = await db.select({ status: importJobItems.status, n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${importJobItems.newVariants}), 0)::int` }).from(importJobItems).where(eq(importJobItems.jobId, jobId)).groupBy(importJobItems.status);
  const c: JobCounts = { pending: 0, processing: 0, succeeded: 0, skipped: 0, failed: 0, cancelled: 0, variantsAdded: 0 };
  for (const r of rows) {
    c[r.status] = r.n;
    c.variantsAdded += r.v;
  }
  return c;
}

export async function getJob(workspaceId: string, jobId: string) {
  const [job] = await db.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.workspaceId, workspaceId)));
  if (!job) throw new HttpError(404, "Import not found.");
  return { job, counts: await jobCounts(job.id) };
}

export async function listJobs(workspaceId: string, limit = 20) {
  const jobs = await db.select().from(importJobs).where(eq(importJobs.workspaceId, workspaceId)).orderBy(desc(importJobs.createdAt)).limit(limit);
  return Promise.all(jobs.map(async (job) => ({ job, counts: await jobCounts(job.id) })));
}

const ITEM_STATUSES = ["pending", "processing", "succeeded", "skipped", "failed", "cancelled"] as const;

export async function listItems(workspaceId: string, jobId: string, opts: { status?: string; offset?: number; limit?: number } = {}) {
  await getJob(workspaceId, jobId);
  const status = ITEM_STATUSES.find((x) => x === opts.status) ?? null;
  return db
    .select()
    .from(importJobItems)
    .where(and(eq(importJobItems.jobId, jobId), status ? eq(importJobItems.status, status) : undefined))
    .orderBy(asc(importJobItems.position))
    .offset(opts.offset ?? 0)
    .limit(Math.min(opts.limit ?? 100, 500));
}

/** The person who queued the job, as an app context (the worker acts on their behalf, within their workspace). */
async function contextFor(job: ImportJob): Promise<AppContext | null> {
  if (!job.createdBy) return null;
  const [row] = await db
    .select({ user, workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, job.createdBy), eq(workspaceMembers.workspaceId, job.workspaceId)));
  if (!row || row.role === "viewer") return null;
  return { user: { id: row.user.id, name: row.user.name, email: row.user.email }, workspace: row.workspace, role: row.role };
}

async function finishIfDone(jobId: string) {
  const c = await jobCounts(jobId);
  if (c.pending || c.processing) return false;
  const [job] = await db.update(importJobs).set({ status: "completed", finishedAt: new Date(), leaseUntil: null }).where(and(eq(importJobs.id, jobId), inArray(importJobs.status, ["queued", "running"]))).returning();
  if (job) {
    await reconcileAfterChange({ workspaceId: job.workspaceId, userId: job.createdBy });
    await logActivity({ workspaceId: job.workspaceId, actorUserId: job.createdBy, kind: "bulk_import", message: `Bulk import finished: ${c.succeeded} imported, ${c.skipped} skipped, ${c.failed} failed (${c.variantsAdded} new variants)`, entityType: "import_job", entityId: job.id, isSimulated: job.isSimulated });
  }
  return true;
}

export interface ChunkResult {
  status: ImportJob["status"];
  processed: number;
  counts: JobCounts;
  /** False when another process holds the job (try again shortly) or it isn't runnable. */
  ran: boolean;
}

/** Process the next 25 links of a job. Safe to call from several places at once. */
export async function processNextChunk(jobId: string, now = new Date()): Promise<ChunkResult> {
  const [job] = await db
    .update(importJobs)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS), status: "running", startedAt: sql`coalesce(${importJobs.startedAt}, now())` })
    .where(and(eq(importJobs.id, jobId), inArray(importJobs.status, ["queued", "running"]), or(sql`${importJobs.leaseUntil} is null`, lt(importJobs.leaseUntil, now))))
    .returning();
  if (!job) {
    const [cur] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, jobId));
    return { status: cur?.status ?? "failed", processed: 0, counts: await jobCounts(jobId), ran: false };
  }
  const release = (patch: Partial<typeof importJobs.$inferInsert> = {}) => db.update(importJobs).set({ leaseUntil: null, ...patch }).where(eq(importJobs.id, jobId));
  try {
    // Links left half-done by a crash or closed tab go back in the queue.
    await db.update(importJobItems).set({ status: "pending" }).where(and(eq(importJobItems.jobId, jobId), eq(importJobItems.status, "processing"), lt(importJobItems.updatedAt, new Date(now.getTime() - STUCK_MS))));
    const claimed = await db.execute<{ id: string }>(sql`
      update import_job_items set status = 'processing', attempts = attempts + 1, updated_at = now()
      where id in (select id from import_job_items where job_id = ${jobId} and status = 'pending' order by position limit ${CHUNK_SIZE} for update skip locked)
      returning id`);
    if (!claimed.length) {
      await finishIfDone(jobId);
      await release();
      const [cur] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, jobId));
      return { status: cur!.status, processed: 0, counts: await jobCounts(jobId), ran: true };
    }
    const items = await db.select().from(importJobItems).where(inArray(importJobItems.id, claimed.map((c) => c.id))).orderBy(asc(importJobItems.position));
    const ctx = await contextFor(job);
    if (!ctx) {
      await db.update(importJobItems).set({ status: "pending", attempts: sql`${importJobItems.attempts} - 1` }).where(inArray(importJobItems.id, items.map((i) => i.id)));
      await release({ status: "failed", lastError: "The person who started this import no longer has edit access to the workspace.", finishedAt: new Date() });
      return { status: "failed", processed: 0, counts: await jobCounts(jobId), ran: true };
    }
    const provider = getActiveProvider();
    const budget = await checkBudget(provider.id, items.length);
    if (!budget.allowed) {
      await db.update(importJobItems).set({ status: "pending", attempts: sql`${importJobItems.attempts} - 1` }).where(inArray(importJobItems.id, items.map((i) => i.id)));
      await release({ status: "paused", lastError: `Paused: ${budget.reason}. Resume when the provider allows more lookups.` });
      return { status: "paused", processed: 0, counts: await jobCounts(jobId), ran: true };
    }
    await processItems(ctx, job, items);
    await finishIfDone(jobId);
    await release();
    const [cur] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, jobId));
    return { status: cur!.status, processed: items.length, counts: await jobCounts(jobId), ran: true };
  } catch (e) {
    logger.error({ err: e, job: jobId }, "bulk import chunk failed");
    await db.update(importJobItems).set({ status: "pending" }).where(and(eq(importJobItems.jobId, jobId), eq(importJobItems.status, "processing")));
    await release({ lastError: "A batch failed unexpectedly and will be retried." });
    return { status: "running", processed: 0, counts: await jobCounts(jobId), ran: true };
  }
}

type Item = typeof importJobItems.$inferSelect;
type ItemPatch = Partial<typeof importJobItems.$inferInsert>;

async function setItem(id: string, patch: ItemPatch) {
  await db.update(importJobItems).set(patch).where(eq(importJobItems.id, id));
}

/** Fail permanently, or go back in the queue for a transient error that has attempts left. */
async function failItem(it: Item, code: string, message: string) {
  if (RETRYABLE.has(code) && it.attempts < MAX_ATTEMPTS) await setItem(it.id, { status: "pending", errorCode: code, error: `${message} (will retry)` });
  else await setItem(it.id, { status: "failed", errorCode: code, error: message });
}

async function processItems(ctx: AppContext, job: ImportJob, items: Item[]) {
  const opts = job.options;
  const defaultMp: MarketplaceCode = isMarketplaceCode(opts.defaultMarketplace) ? opts.defaultMarketplace : "IN";
  // Resolve short links first, so every item has a marketplace + ASIN.
  for (const it of items.filter((i) => !i.asin)) {
    const parsed = parseProductInput(it.input, defaultMp);
    const r = parsed.kind === "short_link" ? await resolveShortLink(parsed.url, defaultMp) : parsed;
    if (r.kind === "listing") {
      it.marketplace = r.marketplace;
      it.asin = r.asin;
      await setItem(it.id, { marketplace: r.marketplace, asin: r.asin });
    } else await failItem(it, r.kind === "error" ? r.code : "unresolved", r.kind === "error" ? r.message : "Couldn't resolve this link.");
  }
  let ready = items.filter((i) => i.asin && i.marketplace && isMarketplaceCode(i.marketplace));

  // With "pasted listing only", a listing the workspace already tracks has nothing to add.
  if (ready.length && opts.variantPolicy === "pasted_only") {
    const tracked = await db
      .select({ marketplace: listings.marketplace, asin: listings.asin, variantId: variants.id })
      .from(variants)
      .innerJoin(listings, eq(listings.id, variants.listingId))
      .where(and(eq(variants.workspaceId, ctx.workspace.id), eq(variants.tracked, true), inArray(listings.asin, ready.map((r) => r.asin!))));
    const have = new Map(tracked.map((t) => [`${t.marketplace}:${t.asin}`, t.variantId]));
    for (const it of ready) {
      const v = have.get(`${it.marketplace}:${it.asin}`);
      if (v) await setItem(it.id, { status: "skipped", errorCode: "already_tracked", error: "Already tracked in this workspace", variantIds: [v], newVariants: 0 });
    }
    ready = ready.filter((it) => !have.has(`${it.marketplace}:${it.asin}`));
  }
  if (!ready.length) return;

  const urlOf = (it: Item) => listingUrl(it.marketplace as MarketplaceCode, it.asin!);
  let preview;
  try {
    preview = await previewImport(ctx, ready.map(urlOf).join("\n"), null, { discoverVariants: opts.variantPolicy === "all_variants" });
  } catch (e) {
    for (const it of ready) await failItem(it, "provider_error", e instanceof HttpError ? e.message : "The data provider couldn't be reached.");
    return;
  }
  const errorsByInput = new Map(preview.errors.map((e) => [e.input, e]));
  for (const it of ready) {
    const key = listingKey(it.marketplace as MarketplaceCode, it.asin!);
    const fam = preview.families.find((f) => f.key === key);
    if (!fam) {
      const err = errorsByInput.get(urlOf(it));
      await failItem(it, err?.code ?? "not_found", err?.message ?? "Nothing was found for this listing.");
      continue;
    }
    const usable = fam.variants.filter((v) => v.status !== "no_data");
    const asins = opts.variantPolicy === "pasted_only" ? [fam.primaryAsin] : usable.filter((v) => !v.alreadyTracked).map((v) => v.asin);
    if (!asins.length) {
      await setItem(it.id, { status: "skipped", errorCode: "already_tracked", error: "Every variant is already tracked", newVariants: 0 });
      continue;
    }
    try {
      const r = await commitImport(ctx, { previewId: preview.previewId, families: [{ key: fam.key, asins }], groupId: opts.groupId ?? undefined, intervalMinutes: opts.intervalMinutes }, { skipReconcile: true });
      const fresh = asins.filter((a) => !fam.variants.find((v) => v.asin === a)?.alreadyTracked).length;
      await setItem(it.id, { status: "succeeded", familyId: r.familyIds[0] ?? null, variantIds: r.variantIds, newVariants: fresh, errorCode: null, error: null });
    } catch (e) {
      await failItem(it, e instanceof HttpError && e.code ? e.code : "commit_failed", e instanceof HttpError ? e.message : "Saving this listing failed.");
    }
  }
}

export const jobActionSchema = z.object({ action: z.enum(["pause", "resume", "cancel", "retry_failed"]) });

const NOT_RETRYABLE = ["duplicate", "empty", "not_a_url", "unsupported_host", "no_asin", "invalid_asin", "unsupported_marketplace", "not_found", "already_tracked"];

export async function jobAction(ctx: AppContext, jobId: string, action: z.infer<typeof jobActionSchema>["action"]) {
  const { job } = await getJob(ctx.workspace.id, jobId);
  const set = (patch: Partial<typeof importJobs.$inferInsert>, from: ImportJob["status"][]) => db.update(importJobs).set(patch).where(and(eq(importJobs.id, jobId), inArray(importJobs.status, from))).returning();
  switch (action) {
    case "pause": {
      const r = await set({ status: "paused" }, ["queued", "running"]);
      if (!r.length) throw new HttpError(409, `This import is ${job.status} and can't be paused.`);
      break;
    }
    case "resume": {
      const r = await set({ status: "queued", lastError: null, leaseUntil: null }, ["paused"]);
      if (!r.length) throw new HttpError(409, `This import is ${job.status}, not paused.`);
      break;
    }
    case "cancel": {
      const r = await set({ status: "cancelled", finishedAt: new Date(), leaseUntil: null }, ["queued", "running", "paused"]);
      if (!r.length) throw new HttpError(409, `This import is already ${job.status}.`);
      await db.update(importJobItems).set({ status: "cancelled", error: "Cancelled before it was processed" }).where(and(eq(importJobItems.jobId, jobId), inArray(importJobItems.status, ["pending", "processing"])));
      await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "bulk_import", message: "Cancelled a bulk import", entityType: "import_job", entityId: jobId });
      break;
    }
    case "retry_failed": {
      const r = await db
        .update(importJobItems)
        .set({ status: "pending", attempts: 0, error: null, errorCode: null })
        .where(and(eq(importJobItems.jobId, jobId), inArray(importJobItems.status, ["failed", "cancelled"]), or(sql`${importJobItems.errorCode} is null`, sql`${importJobItems.errorCode} not in ${NOT_RETRYABLE}`)))
        .returning({ id: importJobItems.id });
      if (!r.length) throw new HttpError(409, "Nothing to retry: the remaining failures are links Aisle can't import (invalid, unsupported or not found).");
      await db.update(importJobs).set({ status: "queued", finishedAt: null, lastError: null, leaseUntil: null }).where(eq(importJobs.id, jobId));
      break;
    }
  }
  return getJob(ctx.workspace.id, jobId);
}

/** Worker / cron: advance runnable jobs within a time budget. */
export async function processImportJobs(opts: { maxChunks?: number; timeBudgetMs?: number } = {}) {
  const started = Date.now();
  const maxChunks = opts.maxChunks ?? 40;
  const timeBudget = opts.timeBudgetMs ?? 50_000;
  let chunks = 0;
  const runnable = await db.select({ id: importJobs.id }).from(importJobs).where(inArray(importJobs.status, ["queued", "running"])).orderBy(asc(importJobs.createdAt)).limit(20);
  for (const j of runnable) {
    while (chunks < maxChunks && Date.now() - started < timeBudget) {
      const r = await processNextChunk(j.id);
      if (!r.ran || r.processed === 0) break;
      chunks++;
    }
  }
  return { jobs: runnable.length, chunks };
}

const CSV_HEADERS = ["row", "input", "marketplace", "asin", "status", "new_variants", "variant_count", "product_id", "reason"];

/** Neutralize spreadsheet formulas and quote every field (CSV injection safe). */
export function csvCell(v: string | number | null) {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportJobCsv(workspaceId: string, jobId: string) {
  await getJob(workspaceId, jobId);
  const rows = await db.select().from(importJobItems).where(eq(importJobItems.jobId, jobId)).orderBy(asc(importJobItems.position));
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) lines.push([r.position + 1, r.input, r.marketplace, r.asin, r.status, r.newVariants, r.variantIds.length, r.familyId, r.error].map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
