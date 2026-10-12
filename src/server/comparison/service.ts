import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { compare, comparabilityScore, type ComparisonInput } from "@/lib/comparison";
import { isNormalizationBasis, NORMALIZATION_BASES, type NormalizationBasis } from "@/lib/quantity";
import { logActivity } from "../activity";
import { listVariantRows, type VariantRow } from "../catalog/queries";
import { db } from "../db/client";
import { brands, comparisonGroups, comparisonItems, variants } from "../db/schema";
import { HttpError } from "../errors";
import type { AppContext } from "../workspace/context";

export async function getGroup(workspaceId: string, groupId: string) {
  const [g] = await db.select().from(comparisonGroups).where(and(eq(comparisonGroups.id, groupId), eq(comparisonGroups.workspaceId, workspaceId)));
  if (!g) throw new HttpError(404, "Comparison not found.");
  return g;
}

export type GroupItemRow = VariantRow & { itemId: string; role: "reference" | "competitor"; status: "confirmed" | "suggested"; position: number };

export async function getGroupDetail(workspaceId: string, groupId: string) {
  const group = await getGroup(workspaceId, groupId);
  const items = await db.select().from(comparisonItems).where(eq(comparisonItems.groupId, groupId));
  const rows = await listVariantRows(workspaceId, { variantIds: items.map((i) => i.variantId), includeArchived: true });
  const refBrandId = group.referenceBrandId;
  const merged: GroupItemRow[] = rows
    .map((r) => {
      const it = items.find((i) => i.variantId === r.variantId)!;
      // An explicit item role wins; otherwise the group's (or workspace's) reference brand decides.
      const role: "reference" | "competitor" = it.role === "reference" ? "reference" : refBrandId ? (r.brandId === refBrandId ? "reference" : "competitor") : r.isReferenceBrand ? "reference" : "competitor";
      return { ...r, itemId: it.id, role, status: it.status, position: it.position };
    })
    .sort((a, b) => a.position - b.position);
  const basis: NormalizationBasis = isNormalizationBasis(group.basis) ? group.basis : "per_100g";
  const input: ComparisonInput[] = merged.map((m) => ({
    id: m.variantId,
    brandName: m.brandName,
    label: m.label,
    productTitle: m.familyTitle,
    role: m.role,
    status: m.status,
    priceMinor: m.priceMinor,
    currency: m.currency,
    availability: m.availability,
    quantities: m.quantities,
  }));
  const result = compare(input, basis);
  const referenceBrand = refBrandId ? (await db.select().from(brands).where(eq(brands.id, refBrandId)))[0] ?? null : null;
  return { group, items: merged, result, referenceBrand };
}

export const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional().nullable(),
  basis: z.string().refine(isNormalizationBasis, "Unknown normalization basis").optional(),
  referenceBrandId: z.string().uuid().nullable().optional(),
  variantIds: z.array(z.string().uuid()).max(200).optional(),
});

export async function createGroup(ctx: AppContext, input: z.infer<typeof groupSchema>) {
  return db.transaction(async (tx) => {
    let basis = input.basis ?? ctx.workspace.defaultBasis;
    let marketplace: string | null = null;
    if (input.variantIds?.length) {
      const owned = await listVariantRows(ctx.workspace.id, { variantIds: input.variantIds });
      if (owned.length !== new Set(input.variantIds).size) throw new HttpError(404, "Some products weren't found.");
      marketplace = owned.every((o) => o.marketplace === owned[0]!.marketplace) ? owned[0]!.marketplace : null;
      // Pick a basis every item can use, if the caller didn't choose.
      if (!input.basis) {
        const dims = owned.map((o) => o.quantities.map((q) => q.dimension));
        const candidates: NormalizationBasis[] = ["per_100g", "per_100ml", "per_unit", "per_serving"];
        basis = candidates.find((b) => dims.every((d) => d.includes(NORMALIZATION_BASES[b].dimension as never))) ?? (dims.flat()[0] === "volume" ? "per_100ml" : dims.flat()[0] === "count" ? "per_unit" : dims.flat().length ? "per_100g" : "per_pack");
      }
    }
    if (input.referenceBrandId) {
      const [b] = await tx.select().from(brands).where(and(eq(brands.id, input.referenceBrandId), eq(brands.workspaceId, ctx.workspace.id)));
      if (!b) throw new HttpError(404, "Brand not found.");
    }
    const [g] = await tx
      .insert(comparisonGroups)
      .values({ workspaceId: ctx.workspace.id, name: input.name, description: input.description ?? null, basis, marketplace, referenceBrandId: input.referenceBrandId ?? null, createdBy: ctx.user.id })
      .returning();
    if (input.variantIds?.length) {
      await tx.insert(comparisonItems).values(input.variantIds.map((variantId, i) => ({ groupId: g!.id, variantId, position: i, status: "confirmed" as const }))).onConflictDoNothing();
    }
    await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "group_created", message: `Created comparison “${g!.name}”`, entityType: "group", entityId: g!.id }, tx);
    return g!;
  });
}

export async function updateGroup(ctx: AppContext, groupId: string, input: Partial<z.infer<typeof groupSchema>>) {
  await getGroup(ctx.workspace.id, groupId);
  if (input.referenceBrandId) {
    const [b] = await db.select().from(brands).where(and(eq(brands.id, input.referenceBrandId), eq(brands.workspaceId, ctx.workspace.id)));
    if (!b) throw new HttpError(404, "Brand not found.");
  }
  await db
    .update(comparisonGroups)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.basis ? { basis: input.basis } : {}),
      ...(input.referenceBrandId !== undefined ? { referenceBrandId: input.referenceBrandId } : {}),
    })
    .where(eq(comparisonGroups.id, groupId));
}

export async function archiveGroup(ctx: AppContext, groupId: string, archived: boolean) {
  const g = await getGroup(ctx.workspace.id, groupId);
  await db.update(comparisonGroups).set({ archivedAt: archived ? new Date() : null }).where(eq(comparisonGroups.id, groupId));
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: archived ? "group_archived" : "group_restored", message: `${archived ? "Archived" : "Restored"} comparison “${g.name}”`, entityType: "group", entityId: groupId });
}

export async function addItems(ctx: AppContext, groupId: string, variantIds: string[], status: "confirmed" | "suggested" = "confirmed") {
  await getGroup(ctx.workspace.id, groupId);
  const owned = await db.select({ id: variants.id }).from(variants).where(and(inArray(variants.id, variantIds), eq(variants.workspaceId, ctx.workspace.id)));
  if (!owned.length) return 0;
  const [{ max } = { max: 0 }] = await db.select({ max: sql<number>`coalesce(max(${comparisonItems.position}), 0)` }).from(comparisonItems).where(eq(comparisonItems.groupId, groupId));
  const res = await db
    .insert(comparisonItems)
    .values(owned.map((o, i) => ({ groupId, variantId: o.id, status, position: Number(max) + i + 1 })))
    .onConflictDoUpdate({ target: [comparisonItems.groupId, comparisonItems.variantId], set: { status: sql`case when excluded.status = 'confirmed' then 'confirmed'::comparison_item_status else ${comparisonItems.status} end` } })
    .returning({ id: comparisonItems.id });
  await db.update(comparisonGroups).set({ updatedAt: new Date() }).where(eq(comparisonGroups.id, groupId));
  return res.length;
}

export const itemPatchSchema = z.object({
  role: z.enum(["reference", "competitor"]).optional(),
  status: z.enum(["confirmed", "suggested"]).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

export async function updateItem(ctx: AppContext, groupId: string, itemId: string, patch: z.infer<typeof itemPatchSchema>) {
  await getGroup(ctx.workspace.id, groupId);
  await db.update(comparisonItems).set(patch).where(and(eq(comparisonItems.id, itemId), eq(comparisonItems.groupId, groupId)));
}

export async function removeItems(ctx: AppContext, groupId: string, variantIds: string[]) {
  await getGroup(ctx.workspace.id, groupId);
  await db.delete(comparisonItems).where(and(eq(comparisonItems.groupId, groupId), inArray(comparisonItems.variantId, variantIds)));
}

export async function reorderItems(ctx: AppContext, groupId: string, orderedItemIds: string[]) {
  await getGroup(ctx.workspace.id, groupId);
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedItemIds.length; i++) {
      await tx.update(comparisonItems).set({ position: i }).where(and(eq(comparisonItems.id, orderedItemIds[i]!), eq(comparisonItems.groupId, groupId)));
    }
  });
}

/**
 * Suggest likely comparable products (never auto-added). Uses category,
 * quantity dimension and pack-size proximity — not title similarity.
 */
export async function suggestForGroup(workspaceId: string, groupId: string) {
  const items = await db.select({ variantId: comparisonItems.variantId }).from(comparisonItems).where(eq(comparisonItems.groupId, groupId));
  const members = await listVariantRows(workspaceId, { variantIds: items.map((i) => i.variantId) });
  if (!members.length) return [];
  const candidates = await listVariantRows(workspaceId);
  const memberIds = new Set(members.map((m) => m.variantId));
  const out: { variant: VariantRow; score: number; reasons: string[] }[] = [];
  for (const c of candidates) {
    if (memberIds.has(c.variantId) || !c.tracked) continue;
    if (members.some((m) => m.marketplace !== c.marketplace)) continue;
    let best = { score: 0, reasons: [] as string[] };
    for (const m of members) {
      const mq = m.quantities[0];
      const cq = c.quantities.find((q) => q.dimension === mq?.dimension) ?? c.quantities[0];
      const s = comparabilityScore({ category: m.categoryName, dimension: mq?.dimension ?? null, totalMilli: mq?.totalMilli ?? null }, { category: c.categoryName, dimension: cq?.dimension ?? null, totalMilli: cq?.totalMilli ?? null });
      if (s.score > best.score) best = s;
    }
    if (best.score >= 0.75) out.push({ variant: c, ...best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

export async function groupsForVariants(workspaceId: string, variantIds: string[]) {
  if (!variantIds.length) return [];
  return db
    .select({ groupId: comparisonGroups.id, name: comparisonGroups.name, variantId: comparisonItems.variantId })
    .from(comparisonItems)
    .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonItems.groupId))
    .where(and(eq(comparisonGroups.workspaceId, workspaceId), inArray(comparisonItems.variantId, variantIds)));
}

