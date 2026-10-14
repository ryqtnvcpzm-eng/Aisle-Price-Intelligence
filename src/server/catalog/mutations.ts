import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../activity";
import { db } from "../db/client";
import { brands, listings, productFamilies, variantQuantities, variants } from "../db/schema";
import { HttpError } from "../errors";
import type { AppContext } from "../workspace/context";
import { reconcileAfterChange } from "../brand/hooks";
import { rescheduleListings } from "./persist";

export const INTERVALS = [60, 180, 360, 720, 1440] as const;

export const variantPatchSchema = z.object({
  tracked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  intervalMinutes: z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440), z.null()]).optional(),
  priority: z.boolean().optional(),
});

async function ownedVariants(workspaceId: string, ids: string[]) {
  const rows = await db.select({ id: variants.id, listingId: variants.listingId }).from(variants).where(and(eq(variants.workspaceId, workspaceId), inArray(variants.id, ids)));
  if (rows.length !== new Set(ids).size) throw new HttpError(404, "Some variants weren't found.");
  return rows;
}

export async function patchVariants(ctx: AppContext, ids: string[], patch: z.infer<typeof variantPatchSchema>) {
  const rows = await ownedVariants(ctx.workspace.id, ids);
  await db.transaction(async (tx) => {
    await tx.update(variants).set(patch).where(inArray(variants.id, ids));
    if (patch.tracked !== undefined || patch.intervalMinutes !== undefined || patch.priority !== undefined) {
      await rescheduleListings(tx, rows.map((r) => r.listingId));
    }
  });
  if (patch.tracked !== undefined || patch.hidden !== undefined) await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  if (patch.tracked !== undefined || patch.intervalMinutes !== undefined) {
    const what = patch.tracked === false ? "Stopped tracking" : patch.tracked ? "Started tracking" : patch.intervalMinutes === null ? "Paused monitoring for" : "Changed monitoring for";
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "monitoring_changed", message: `${what} ${ids.length} variant${ids.length === 1 ? "" : "s"}`, metadata: { ids, patch } });
  }
}

export const quantitySchema = z.object({
  dimension: z.enum(["mass", "volume", "count", "serving"]),
  packCount: z.number().int().min(1).max(1000),
  unitAmount: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(24),
});

const UNIT_MILLI: Record<string, number> = { mg: 1, g: 1000, kg: 1_000_000, ml: 1000, l: 1_000_000, "fl oz": 29_574, oz: 28_350, lb: 453_592 };

/** Manual correction: the only way a quantity becomes "manual" (trusted). Preserves the original source text. */
export async function setQuantity(ctx: AppContext, variantId: string, input: z.infer<typeof quantitySchema>) {
  await ownedVariants(ctx.workspace.id, [variantId]);
  const perUnit = input.dimension === "mass" || input.dimension === "volume" ? UNIT_MILLI[input.unit.toLowerCase()] : 1000;
  if (!perUnit) throw new HttpError(400, `Unknown unit “${input.unit}”.`);
  const totalMilli = Math.round(input.packCount * input.unitAmount * perUnit);
  await db
    .insert(variantQuantities)
    .values({ variantId, dimension: input.dimension, packCount: input.packCount, unitAmount: String(input.unitAmount), unit: input.unit, totalMilli, confidence: "manual", updatedBy: ctx.user.id, countNoun: input.dimension === "count" ? input.unit : null })
    .onConflictDoUpdate({
      target: [variantQuantities.variantId, variantQuantities.dimension],
      set: { packCount: input.packCount, unitAmount: String(input.unitAmount), unit: input.unit, totalMilli, confidence: "manual", updatedBy: ctx.user.id, updatedAt: new Date() },
    });
  await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "quantity_corrected", message: `Corrected quantity to ${input.packCount > 1 ? `${input.packCount} × ` : ""}${input.unitAmount} ${input.unit}`, entityType: "variant", entityId: variantId });
}

export async function deleteQuantity(ctx: AppContext, variantId: string, dimension: string) {
  await ownedVariants(ctx.workspace.id, [variantId]);
  await db.delete(variantQuantities).where(and(eq(variantQuantities.variantId, variantId), sql`${variantQuantities.dimension} = ${dimension}`));
  await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
}

export const familyPatchSchema = z.object({
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  brandName: z.string().trim().min(1).max(80).optional(),
});

/** Bulk family updates. Archiving pauses monitoring but keeps history (reversible → undo). */
export async function patchFamilies(ctx: AppContext, ids: string[], patch: z.infer<typeof familyPatchSchema>) {
  const fams = await db.select({ id: productFamilies.id }).from(productFamilies).where(and(eq(productFamilies.workspaceId, ctx.workspace.id), inArray(productFamilies.id, ids)));
  if (fams.length !== new Set(ids).size) throw new HttpError(404, "Some products weren't found.");
  await db.transaction(async (tx) => {
    let brandId: string | undefined;
    if (patch.brandName) {
      const slug = patch.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const [b] = await tx.insert(brands).values({ workspaceId: ctx.workspace.id, name: patch.brandName, slug }).onConflictDoUpdate({ target: [brands.workspaceId, brands.slug], set: { name: patch.brandName } }).returning({ id: brands.id });
      brandId = b!.id;
    }
    await tx
      .update(productFamilies)
      .set({
        ...(patch.favorite !== undefined ? { favorite: patch.favorite } : {}),
        ...(patch.tags ? { tags: patch.tags } : {}),
        ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
        ...(brandId ? { brandId } : {}),
      })
      .where(inArray(productFamilies.id, ids));
    if (patch.archived !== undefined) {
      await tx.update(variants).set({ tracked: !patch.archived }).where(inArray(variants.familyId, ids));
      const ls = await tx.select({ id: variants.listingId }).from(variants).where(inArray(variants.familyId, ids));
      await rescheduleListings(tx, ls.map((l) => l.id));
    }
  });
  if (patch.archived !== undefined || patch.brandName) await reconcileAfterChange({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
  if (patch.archived !== undefined) {
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: patch.archived ? "archived" : "restored", message: `${patch.archived ? "Archived" : "Restored"} ${ids.length} product${ids.length === 1 ? "" : "s"}`, metadata: { ids } });
  }
}

export async function listingRowsForVariants(workspaceId: string, variantIds: string[]) {
  return db
    .select({ id: listings.id, provider: listings.provider, marketplace: listings.marketplace })
    .from(variants)
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .where(and(eq(variants.workspaceId, workspaceId), inArray(variants.id, variantIds)));
}
