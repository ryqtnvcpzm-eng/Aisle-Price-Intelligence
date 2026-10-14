import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../activity";
import { reconcileAfterChange } from "../brand/hooks";
import { db } from "../db/client";
import { brands, listings, productFamilies, variants } from "../db/schema";
import { getProvider, type ProviderId } from "../providers";
import type { AppContext } from "../workspace/context";
import { rescheduleListings } from "./persist";

/**
 * Bulk edits with an honest, per-item account of what happened. Every id is
 * either updated, skipped (with the reason — usually "already like that"), or
 * failed (with the reason — e.g. not in this workspace). Nothing is silently
 * dropped, and a partial result never claims more than it did.
 */

const uuid = z.string().uuid();
const interval = z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440), z.null()]);
const tag = z.string().trim().min(1).max(32);
export const MAX_TAGS = 12;

export const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("brand"), familyIds: z.array(uuid).min(1).max(2000), brandName: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("frequency"), variantIds: z.array(uuid).min(1).max(5000), intervalMinutes: interval }),
  z.object({ action: z.literal("tags"), familyIds: z.array(uuid).min(1).max(2000), mode: z.enum(["add", "remove", "replace"]), tags: z.array(tag).max(MAX_TAGS) }),
]);
export type BulkInput = z.infer<typeof bulkSchema>;

export interface BulkOutcome {
  id: string;
  label: string;
  reason: string;
}

export interface BulkResult {
  action: BulkInput["action"];
  requested: number;
  updated: number;
  skipped: BulkOutcome[];
  failed: BulkOutcome[];
}

const INTERVAL_LABEL: Record<string, string> = { "60": "hourly", "180": "every 3 hours", "360": "every 6 hours", "720": "every 12 hours", "1440": "daily", null: "paused" };

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "brand";
}

/** Trim, drop empties and de-duplicate case-insensitively (first spelling wins). */
export function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags.map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function applyTagEdit(current: string[], mode: "add" | "remove" | "replace", tags: string[]) {
  const t = normalizeTags(tags);
  if (mode === "replace") return t;
  if (mode === "add") return normalizeTags([...current, ...t]);
  const drop = new Set(t.map((x) => x.toLowerCase()));
  return current.filter((x) => !drop.has(x.toLowerCase()));
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export async function bulkEdit(ctx: AppContext, input: BulkInput): Promise<BulkResult> {
  switch (input.action) {
    case "brand":
      return bulkBrand(ctx, input);
    case "frequency":
      return bulkFrequency(ctx, input);
    case "tags":
      return bulkTags(ctx, input);
  }
}

async function familiesFor(ctx: AppContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ id: productFamilies.id, title: productFamilies.title, tags: productFamilies.tags, brandId: productFamilies.brandId, brandName: brands.name })
    .from(productFamilies)
    .leftJoin(brands, eq(brands.id, productFamilies.brandId))
    .where(and(eq(productFamilies.workspaceId, ctx.workspace.id), inArray(productFamilies.id, unique)));
  const found = new Map(rows.map((r) => [r.id, r]));
  const failed: BulkOutcome[] = unique.filter((id) => !found.has(id)).map((id) => ({ id, label: id, reason: "Not found in this workspace" }));
  return { unique, rows, failed };
}

async function bulkBrand(ctx: AppContext, input: Extract<BulkInput, { action: "brand" }>): Promise<BulkResult> {
  const { unique, rows, failed } = await familiesFor(ctx, input.familyIds);
  const skipped: BulkOutcome[] = [];
  const updated = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(brands)
      .values({ workspaceId: ctx.workspace.id, name: input.brandName, slug: slugify(input.brandName) })
      .onConflictDoUpdate({ target: [brands.workspaceId, brands.slug], set: { name: sql`${brands.name}` } })
      .returning({ id: brands.id, name: brands.name });
    const change = rows.filter((r) => {
      if (r.brandId === b!.id) {
        skipped.push({ id: r.id, label: r.title, reason: `Already ${b!.name}` });
        return false;
      }
      return true;
    });
    if (change.length) await tx.update(productFamilies).set({ brandId: b!.id }).where(inArray(productFamilies.id, change.map((c) => c.id)));
    return change.length;
  });
  if (updated) {
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "bulk_edit", message: `Changed the brand of ${updated} product${updated === 1 ? "" : "s"} to ${input.brandName}`, metadata: { action: "brand", updated, skipped: skipped.length, failed: failed.length } });
    await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  }
  return { action: "brand", requested: unique.length, updated, skipped, failed };
}

async function bulkFrequency(ctx: AppContext, input: Extract<BulkInput, { action: "frequency" }>): Promise<BulkResult> {
  const unique = [...new Set(input.variantIds)];
  const rows = await db
    .select({ id: variants.id, label: variants.label, title: productFamilies.title, tracked: variants.tracked, interval: variants.intervalMinutes, listingId: variants.listingId, provider: listings.provider, archivedAt: productFamilies.archivedAt })
    .from(variants)
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .where(and(eq(variants.workspaceId, ctx.workspace.id), inArray(variants.id, unique)));
  const found = new Map(rows.map((r) => [r.id, r]));
  const failed: BulkOutcome[] = unique.filter((id) => !found.has(id)).map((id) => ({ id, label: id, reason: "Not found in this workspace" }));
  const skipped: BulkOutcome[] = [];
  const change: typeof rows = [];
  for (const r of rows) {
    const label = `${r.title.split(",")[0]} · ${r.label}`;
    if (r.archivedAt || !r.tracked) {
      skipped.push({ id: r.id, label, reason: r.archivedAt ? "Archived — restore it to monitor again" : "Not tracked" });
      continue;
    }
    if (r.interval === input.intervalMinutes) {
      skipped.push({ id: r.id, label, reason: `Already ${INTERVAL_LABEL[String(input.intervalMinutes)]}` });
      continue;
    }
    if (input.intervalMinutes !== null) {
      let monitoring = false;
      try {
        monitoring = getProvider(r.provider as ProviderId).capabilities.monitoring;
      } catch {
        failed.push({ id: r.id, label, reason: "Its data provider isn't configured" });
        continue;
      }
      if (!monitoring) {
        skipped.push({ id: r.id, label, reason: "Its data provider doesn't permit scheduled monitoring" });
        continue;
      }
    }
    change.push(r);
  }
  if (change.length) {
    await db.transaction(async (tx) => {
      await tx.update(variants).set({ intervalMinutes: input.intervalMinutes }).where(inArray(variants.id, change.map((c) => c.id)));
      await rescheduleListings(tx, [...new Set(change.map((c) => c.listingId))]);
    });
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "monitoring_changed", message: `Set ${change.length} variant${change.length === 1 ? "" : "s"} to ${INTERVAL_LABEL[String(input.intervalMinutes)]} monitoring`, metadata: { action: "frequency", intervalMinutes: input.intervalMinutes, updated: change.length, skipped: skipped.length, failed: failed.length } });
  }
  return { action: "frequency", requested: unique.length, updated: change.length, skipped, failed };
}

async function bulkTags(ctx: AppContext, input: Extract<BulkInput, { action: "tags" }>): Promise<BulkResult> {
  const { unique, rows, failed } = await familiesFor(ctx, input.familyIds);
  const skipped: BulkOutcome[] = [];
  const next = new Map<string, string[]>();
  for (const r of rows) {
    const tags = applyTagEdit(r.tags, input.mode, input.tags);
    if (tags.length > MAX_TAGS) {
      failed.push({ id: r.id, label: r.title, reason: `Would have ${tags.length} tags (the limit is ${MAX_TAGS})` });
      continue;
    }
    if (sameSet(tags, r.tags)) {
      skipped.push({ id: r.id, label: r.title, reason: input.mode === "remove" ? "Didn't have those tags" : "Already tagged like that" });
      continue;
    }
    next.set(r.id, tags);
  }
  if (next.size) {
    await db.transaction(async (tx) => {
      for (const [id, tags] of next) await tx.update(productFamilies).set({ tags }).where(eq(productFamilies.id, id));
    });
    const verb = input.mode === "add" ? "Added tags to" : input.mode === "remove" ? "Removed tags from" : "Replaced tags on";
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "bulk_edit", message: `${verb} ${next.size} product${next.size === 1 ? "" : "s"}`, metadata: { action: "tags", mode: input.mode, tags: input.tags, updated: next.size, skipped: skipped.length, failed: failed.length } });
  }
  return { action: "tags", requested: unique.length, updated: next.size, skipped, failed };
}
