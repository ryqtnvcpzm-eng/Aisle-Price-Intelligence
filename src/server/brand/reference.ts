import "server-only";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { buildCohorts, cohortName, type CohortInput, type Unmatched } from "@/lib/cohorts";
import type { Dimension } from "@/lib/quantity";
import { logActivity } from "../activity";
import { syncProtectionRules } from "../alerts/protection";
import { db, type Tx } from "../db/client";
import { brands, categories, comparisonGroups, comparisonItems, productFamilies, variantQuantities, variants, workspaces } from "../db/schema";
import { HttpError } from "../errors";

/** The managed set of comparisons built around the workspace's own brand. */
export const REFERENCE_MARKET = "reference_market";

/** Who is acting: a signed-in user, or the system (worker, bulk import) with no user. */
export interface Actor {
  workspaceId: string;
  userId: string | null;
}

export async function getReferenceBrand(workspaceId: string, tx: Tx | typeof db = db) {
  const [b] = await tx.select().from(brands).where(and(eq(brands.workspaceId, workspaceId), eq(brands.isReference, true)));
  return b ?? null;
}

/** Lightweight catalog read for cohort building (no price history joins). */
async function cohortRows(workspaceId: string, tx: Tx | typeof db): Promise<CohortInput[]> {
  const rows = await tx
    .select({
      variantId: variants.id,
      familyId: productFamilies.id,
      familyTitle: productFamilies.title,
      label: variants.label,
      brandId: productFamilies.brandId,
      brandName: brands.name,
      marketplace: productFamilies.marketplace,
      categoryName: categories.name,
      tracked: variants.tracked,
      hidden: variants.hidden,
    })
    .from(variants)
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .leftJoin(brands, eq(brands.id, productFamilies.brandId))
    .leftJoin(categories, eq(categories.id, productFamilies.categoryId))
    .where(and(eq(variants.workspaceId, workspaceId), isNull(productFamilies.archivedAt)));
  const ids = rows.map((r) => r.variantId);
  const qs = ids.length ? await tx.select({ variantId: variantQuantities.variantId, dimension: variantQuantities.dimension }).from(variantQuantities).where(inArray(variantQuantities.variantId, ids)) : [];
  const dims = new Map<string, { dimension: Dimension }[]>();
  for (const q of qs) dims.set(q.variantId, [...(dims.get(q.variantId) ?? []), { dimension: q.dimension }]);
  return rows.map((r) => ({ ...r, quantities: dims.get(r.variantId) ?? [] }));
}

export interface ReconcileCohort {
  key: string;
  name: string;
  groupId: string | null;
  action: "create" | "update" | "keep";
  marketplace: string;
  categoryName: string | null;
  basis: string;
  references: number;
  competitors: number;
  added: number;
  removed: number;
}

export interface ReconcileResult {
  /** `id` is null when previewing a brand name that doesn't exist yet. */
  brand: { id: string | null; name: string } | null;
  cohorts: ReconcileCohort[];
  archived: { groupId: string; name: string }[];
  unmatched: Unmatched[];
  protection: { enabled: boolean; activeRules: number };
  applied: boolean;
}

/**
 * Bring the managed "{Brand} vs Market" comparisons in line with the catalog
 * and the current reference brand. Idempotent: running it twice changes
 * nothing the second time. Managed groups that no longer qualify are archived
 * (never deleted), so their history and alert events are kept.
 *
 * `dryRun` computes the same plan without writing — used to preview the impact
 * of choosing a different brand before the user confirms.
 */
export async function reconcileReferenceMarket(actor: Actor, opts: { dryRun?: boolean; brandId?: string | null } = {}): Promise<ReconcileResult> {
  const run = async (tx: Tx): Promise<ReconcileResult> => {
    // Serialize reconciles per workspace so concurrent imports and brand changes can't interleave.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`reconcile:${actor.workspaceId}`}))`);
    let brand: { id: string; name: string } | null;
    if (opts.brandId !== undefined) {
      if (opts.brandId === null) brand = null;
      else {
        const [b] = await tx.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.id, opts.brandId), eq(brands.workspaceId, actor.workspaceId)));
        if (!b) throw new HttpError(404, "Brand not found.");
        brand = b;
      }
    } else {
      const b = await getReferenceBrand(actor.workspaceId, tx);
      brand = b ? { id: b.id, name: b.name } : null;
    }

    const existing = await tx.select().from(comparisonGroups).where(and(eq(comparisonGroups.workspaceId, actor.workspaceId), eq(comparisonGroups.managedBy, REFERENCE_MARKET)));
    const byKey = new Map(existing.map((g) => [g.managedCohort ?? "", g]));
    const existingItems = existing.length ? await tx.select({ groupId: comparisonItems.groupId, variantId: comparisonItems.variantId }).from(comparisonItems).where(inArray(comparisonItems.groupId, existing.map((g) => g.id))) : [];

    const rows = brand ? await cohortRows(actor.workspaceId, tx) : [];
    const { cohorts, unmatched } = brand ? buildCohorts(rows, brand.id) : { cohorts: [], unmatched: [] };
    const multiMarketplace = new Set(cohorts.map((c) => c.marketplace)).size > 1;

    const plan: ReconcileCohort[] = cohorts.map((c) => {
      const g = byKey.get(c.key);
      const desired = new Set([...c.referenceVariantIds, ...c.competitorVariantIds]);
      const current = new Set(existingItems.filter((i) => i.groupId === g?.id).map((i) => i.variantId));
      const added = [...desired].filter((id) => !current.has(id)).length;
      const removed = [...current].filter((id) => !desired.has(id)).length;
      const name = cohortName(brand!.name, c, multiMarketplace);
      const changed = !g || g.archivedAt !== null || g.name !== name || g.referenceBrandId !== brand!.id || g.basis !== c.basis || added > 0 || removed > 0;
      return { key: c.key, name, groupId: g?.id ?? null, action: !g ? "create" : changed ? "update" : "keep", marketplace: c.marketplace, categoryName: c.categoryName, basis: c.basis, references: c.referenceVariantIds.length, competitors: c.competitorVariantIds.length, added, removed };
    });
    const keep = new Set(cohorts.map((c) => c.key));
    const archived = existing.filter((g) => !g.archivedAt && !keep.has(g.managedCohort ?? "")).map((g) => ({ groupId: g.id, name: g.name }));
    const [ws] = await tx.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, actor.workspaceId));
    const protectionEnabled = Boolean(ws?.settings.brandProtection);

    if (opts.dryRun) return { brand, cohorts: plan, archived, unmatched, protection: { enabled: protectionEnabled, activeRules: 0 }, applied: false };

    const now = new Date();
    for (let i = 0; i < cohorts.length; i++) {
      const c = cohorts[i]!;
      const p = plan[i]!;
      let groupId = p.groupId;
      if (!groupId) {
        const [g] = await tx
          .insert(comparisonGroups)
          .values({ workspaceId: actor.workspaceId, name: p.name, description: "Maintained by Aisle: every tracked listing in this category and unit, compared with your brand.", basis: c.basis, marketplace: c.marketplace, referenceBrandId: brand!.id, managedBy: REFERENCE_MARKET, managedCohort: c.key, createdBy: actor.userId })
          .returning({ id: comparisonGroups.id });
        groupId = g!.id;
        p.groupId = groupId;
      } else if (p.action === "update") {
        await tx.update(comparisonGroups).set({ name: p.name, basis: c.basis, marketplace: c.marketplace, referenceBrandId: brand!.id, archivedAt: null, updatedAt: now }).where(eq(comparisonGroups.id, groupId));
      }
      const desired = [...c.referenceVariantIds, ...c.competitorVariantIds];
      if (p.removed) await tx.delete(comparisonItems).where(and(eq(comparisonItems.groupId, groupId), notInArray(comparisonItems.variantId, desired)));
      if (p.added) {
        // Reference listings first, then competitors; existing items keep their position and status.
        await tx
          .insert(comparisonItems)
          .values(desired.map((variantId, position) => ({ groupId: groupId!, variantId, position, status: "confirmed" as const })))
          .onConflictDoNothing({ target: [comparisonItems.groupId, comparisonItems.variantId] });
      }
    }
    if (archived.length) await tx.update(comparisonGroups).set({ archivedAt: now }).where(inArray(comparisonGroups.id, archived.map((a) => a.groupId)));

    const active = plan.filter((p) => p.groupId).map((p) => ({ id: p.groupId!, name: p.name }));
    const activeRules = await syncProtectionRules(tx, actor, { groups: active, enabled: protectionEnabled, resume: false });

    const changed = plan.some((p) => p.action !== "keep") || archived.length > 0;
    if (changed) {
      await logActivity(
        {
          workspaceId: actor.workspaceId,
          actorUserId: actor.userId,
          kind: "reference_market",
          message: brand ? `Updated ${brand.name} vs Market: ${plan.length} comparison${plan.length === 1 ? "" : "s"}, ${unmatched.length} listing${unmatched.length === 1 ? "" : "s"} not yet matched` : `Archived ${archived.length} managed comparison${archived.length === 1 ? "" : "s"} (no reference brand)`,
          metadata: { created: plan.filter((p) => p.action === "create").length, updated: plan.filter((p) => p.action === "update").length, archived: archived.length, unmatched: unmatched.length },
        },
        tx,
      );
    }
    return { brand, cohorts: plan, archived, unmatched, protection: { enabled: protectionEnabled, activeRules }, applied: true };
  };
  return db.transaction(run);
}

export const referenceInputSchema = z.union([z.object({ brandId: z.string().uuid().nullable() }), z.object({ brandName: z.string().trim().min(1).max(80) })]);
export type ReferenceInput = z.infer<typeof referenceInputSchema>;

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "brand";
}

/** Resolve a brand id from an id or a (possibly new) name. Creating a brand by name is the only write. */
async function resolveBrandId(tx: Tx, workspaceId: string, input: ReferenceInput): Promise<string | null> {
  if ("brandId" in input) {
    if (input.brandId === null) return null;
    const [b] = await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.id, input.brandId), eq(brands.workspaceId, workspaceId)));
    if (!b) throw new HttpError(404, "Brand not found.");
    return b.id;
  }
  const slug = slugify(input.brandName);
  const [b] = await tx
    .insert(brands)
    .values({ workspaceId, name: input.brandName, slug })
    .onConflictDoUpdate({ target: [brands.workspaceId, brands.slug], set: { name: sql`${brands.name}` } })
    .returning({ id: brands.id });
  return b!.id;
}

/** Preview what choosing this brand would change, without writing anything. */
export async function planReferenceChange(actor: Actor, input: ReferenceInput) {
  if ("brandName" in input) {
    const [b] = await db.select({ id: brands.id }).from(brands).where(and(eq(brands.workspaceId, actor.workspaceId), eq(brands.slug, slugify(input.brandName))));
    // A brand that doesn't exist yet has no listings: every cohort would lack a reference.
    if (!b) return reconcileReferenceMarket(actor, { dryRun: true, brandId: null }).then((r) => ({ ...r, brand: { id: null, name: input.brandName } }));
    return reconcileReferenceMarket(actor, { dryRun: true, brandId: b.id });
  }
  return reconcileReferenceMarket(actor, { dryRun: true, brandId: input.brandId });
}

/**
 * Make a brand the workspace's reference ("My Brand") and reconcile everything
 * built on it. The one entry point used by onboarding, the import dialog and
 * the Brands page, so they can't drift apart.
 */
export async function setReferenceBrand(actor: Actor, input: ReferenceInput) {
  const brand = await db.transaction(async (tx) => {
    const id = await resolveBrandId(tx, actor.workspaceId, input);
    const previous = await getReferenceBrand(actor.workspaceId, tx);
    if (previous?.id === id) return previous;
    await tx.update(brands).set({ isReference: false }).where(and(eq(brands.workspaceId, actor.workspaceId), eq(brands.isReference, true)));
    if (!id) {
      await logActivity({ workspaceId: actor.workspaceId, actorUserId: actor.userId, kind: "reference_brand", message: previous ? `Cleared ${previous.name} as your brand` : "Cleared your brand" }, tx);
      return null;
    }
    const [b] = await tx.update(brands).set({ isReference: true }).where(and(eq(brands.id, id), eq(brands.workspaceId, actor.workspaceId))).returning();
    await logActivity({ workspaceId: actor.workspaceId, actorUserId: actor.userId, kind: "reference_brand", message: previous ? `Changed your brand from ${previous.name} to ${b!.name}` : `Set ${b!.name} as your brand`, entityType: "brand", entityId: id, metadata: { previousBrandId: previous?.id ?? null } }, tx);
    return b!;
  });
  const reconcile = await reconcileReferenceMarket(actor);
  return { brand: brand ? { id: brand.id, name: brand.name } : null, reconcile };
}

/** Reconcile only when the workspace has a reference brand — cheap no-op otherwise. Used after imports and bulk edits. */
export async function reconcileIfConfigured(actor: Actor) {
  const ref = await getReferenceBrand(actor.workspaceId);
  const [managed] = await db.select({ n: sql<number>`count(*)::int` }).from(comparisonGroups).where(and(eq(comparisonGroups.workspaceId, actor.workspaceId), eq(comparisonGroups.managedBy, REFERENCE_MARKET)));
  if (!ref && !managed?.n) return null;
  return reconcileReferenceMarket(actor);
}

/** The "My Brand" overview: the brand, its managed comparisons and what isn't matched yet. */
export async function referenceOverview(workspaceId: string) {
  const ref = await getReferenceBrand(workspaceId);
  const groups = await db
    .select({ id: comparisonGroups.id, name: comparisonGroups.name, basis: comparisonGroups.basis, marketplace: comparisonGroups.marketplace, cohort: comparisonGroups.managedCohort, items: sql<number>`count(${comparisonItems.id})::int` })
    .from(comparisonGroups)
    .leftJoin(comparisonItems, eq(comparisonItems.groupId, comparisonGroups.id))
    .where(and(eq(comparisonGroups.workspaceId, workspaceId), eq(comparisonGroups.managedBy, REFERENCE_MARKET), isNull(comparisonGroups.archivedAt)))
    .groupBy(comparisonGroups.id)
    .orderBy(comparisonGroups.name);
  const unmatched = ref ? buildCohorts(await cohortRows(workspaceId, db), ref.id).unmatched : [];
  return { brand: ref ? { id: ref.id, name: ref.name } : null, groups, unmatched };
}
