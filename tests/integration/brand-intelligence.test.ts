/**
 * Reference brand ("My Brand"), the managed "{Brand} vs Market" comparisons
 * and the Protect My Brand pack, against a real Postgres with the demo provider.
 * The reference brand is deliberately not the demo catalog's default brand, to
 * prove nothing about it is hardcoded.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlertsForListings } from "@/server/alerts/engine";
import { disableProtection, enableProtection, protectionStatus } from "@/server/alerts/protection";
import { deleteRule } from "@/server/alerts/service";
import { getReferenceBrand, planReferenceChange, reconcileReferenceMarket, referenceOverview, setReferenceBrand } from "@/server/brand/reference";
import { patchFamilies } from "@/server/catalog/mutations";
import { listVariantRows } from "@/server/catalog/queries";
import { getGroupDetail } from "@/server/comparison/service";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { importFamily, makeContext, observe, restoreObservedListings } from "../support/fixtures";

let ctx: AppContext;
let other: AppContext;
const actor = () => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id });
let clock = Date.now() + 60_000;
const tick = () => new Date((clock += 60_000));

beforeAll(async () => {
  ctx = await makeContext("Brand owner");
  other = await makeContext("Other team");
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE002"); // Lumen plant protein (5 sizes)
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE007"); // Northfield pea protein
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE011"); // Pureform organic protein
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE019"); // Daily Root multivitamin (no Northfield or Lumen counterpart imported)
});

afterAll(async () => {
  await restoreObservedListings();
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

async function managedGroups(workspaceId: string) {
  return db.select().from(s.comparisonGroups).where(and(eq(s.comparisonGroups.workspaceId, workspaceId), eq(s.comparisonGroups.managedBy, "reference_market")));
}

describe("reference brand", () => {
  it("starts with no reference brand and no managed comparisons", async () => {
    expect(await getReferenceBrand(ctx.workspace.id)).toBeNull();
    expect(await managedGroups(ctx.workspace.id)).toHaveLength(0);
  });

  it("previews a change without writing anything", async () => {
    const plan = await planReferenceChange(actor(), { brandName: "Northfield Labs" });
    expect(plan.applied).toBe(false);
    expect(plan.cohorts.length).toBeGreaterThan(0);
    expect(plan.cohorts.every((c) => c.action === "create")).toBe(true);
    expect(await managedGroups(ctx.workspace.id)).toHaveLength(0);
    expect(await getReferenceBrand(ctx.workspace.id)).toBeNull();
  });

  it("sets any brand as the reference and builds unit-compatible cohorts", async () => {
    const r = await setReferenceBrand(actor(), { brandName: "Northfield Labs" });
    expect(r.brand?.name).toBe("Northfield Labs");
    const groups = await managedGroups(ctx.workspace.id);
    expect(groups.length).toBe(r.reconcile.cohorts.length);
    for (const g of groups) {
      expect(g.name.startsWith("Northfield Labs vs Market")).toBe(true);
      expect(g.referenceBrandId).toBe(r.brand!.id);
    }
    // Every member of a cohort shares marketplace, category and unit; the reference brand is the reference role.
    const protein = groups.find((g) => g.basis === "per_100g")!;
    const d = await getGroupDetail(ctx.workspace.id, protein.id);
    expect(new Set(d.items.map((i) => i.marketplace)).size).toBe(1);
    expect(new Set(d.items.map((i) => i.categoryName)).size).toBe(1);
    expect(d.items.filter((i) => i.role === "reference").every((i) => i.brandName === "Northfield Labs")).toBe(true);
    expect(d.items.some((i) => i.role === "competitor")).toBe(true);
    // Listings with no Northfield counterpart are reported, not silently dropped.
    const overview = await referenceOverview(ctx.workspace.id);
    expect(overview.unmatched.length).toBeGreaterThan(0);
    expect(overview.unmatched.every((u) => ["no_quantity", "no_reference_in_cohort", "no_competitor_in_cohort"].includes(u.reason))).toBe(true);
  });

  it("is idempotent: reconciling again changes nothing", async () => {
    const before = await managedGroups(ctx.workspace.id);
    const again = await reconcileReferenceMarket(actor());
    expect(again.cohorts.every((c) => c.action === "keep")).toBe(true);
    expect(again.archived).toHaveLength(0);
    const after = await managedGroups(ctx.workspace.id);
    expect(after.map((g) => g.id).sort()).toEqual(before.map((g) => g.id).sort());
  });

  it("switching brands reuses the same cohort groups and renames them", async () => {
    const before = await managedGroups(ctx.workspace.id);
    const lumen = (await db.select().from(s.brands).where(and(eq(s.brands.workspaceId, ctx.workspace.id), eq(s.brands.name, "Lumen Nutrition"))))[0]!;
    const r = await setReferenceBrand(actor(), { brandId: lumen.id });
    expect(r.brand?.id).toBe(lumen.id);
    const after = await managedGroups(ctx.workspace.id);
    const proteinBefore = before.find((g) => g.basis === "per_100g")!;
    const proteinAfter = after.find((g) => g.id === proteinBefore.id)!;
    expect(proteinAfter.name.startsWith("Lumen Nutrition vs Market")).toBe(true);
    expect(proteinAfter.referenceBrandId).toBe(lumen.id);
    // Exactly one reference brand per workspace.
    const refs = await db.select().from(s.brands).where(and(eq(s.brands.workspaceId, ctx.workspace.id), eq(s.brands.isReference, true)));
    expect(refs).toHaveLength(1);
  });

  it("archives (never deletes) cohorts that stop qualifying, and restores them", async () => {
    const protein = (await managedGroups(ctx.workspace.id)).find((g) => g.basis === "per_100g" && !g.archivedAt)!;
    const comps = (await listVariantRows(ctx.workspace.id)).filter((v) => v.brandName !== "Lumen Nutrition" && v.categoryName === "Plant Protein");
    const families = [...new Set(comps.map((c) => c.familyId))];
    await patchFamilies(ctx, families, { archived: true });
    const [archived] = await db.select().from(s.comparisonGroups).where(eq(s.comparisonGroups.id, protein.id));
    expect(archived!.archivedAt).not.toBeNull();
    await patchFamilies(ctx, families, { archived: false });
    const [restored] = await db.select().from(s.comparisonGroups).where(eq(s.comparisonGroups.id, protein.id));
    expect(restored!.archivedAt).toBeNull();
  });

  it("keeps workspaces isolated", async () => {
    await expect(setReferenceBrand({ workspaceId: other.workspace.id, userId: other.user.id }, { brandId: (await getReferenceBrand(ctx.workspace.id))!.id })).rejects.toMatchObject({ status: 404 });
    expect(await managedGroups(other.workspace.id)).toHaveLength(0);
  });
});

describe("Protect My Brand", () => {
  let groupIds: string[] = [];

  it("refuses without a reference brand", async () => {
    await expect(enableProtection({ workspaceId: other.workspace.id, userId: other.user.id })).rejects.toMatchObject({ status: 409 });
  });

  it("creates four managed rules per comparison, idempotently", async () => {
    const r1 = await enableProtection(actor());
    const r2 = await enableProtection(actor());
    expect(r2.activeRules).toBe(r1.activeRules);
    groupIds = (await managedGroups(ctx.workspace.id)).filter((g) => !g.archivedAt).map((g) => g.id);
    const rules = await db.select().from(s.alertRules).where(and(eq(s.alertRules.workspaceId, ctx.workspace.id), like(s.alertRules.managedKey, "protect:%")));
    expect(rules).toHaveLength(groupIds.length * 4);
    expect(new Set(rules.map((r) => r.type))).toEqual(new Set(["competitor_undercut", "price_leadership_change", "reference_out_of_stock", "rival_drop_5pct"]));
    expect(rules.every((r) => r.cooldownMinutes === 1440)).toBe(true);
  });

  it("won't let a managed rule be deleted, and pauses rather than deletes when turned off", async () => {
    const [rule] = await db.select().from(s.alertRules).where(and(eq(s.alertRules.workspaceId, ctx.workspace.id), like(s.alertRules.managedKey, "protect:%")));
    await expect(deleteRule(ctx, rule!.id)).rejects.toMatchObject({ status: 409 });
    await disableProtection(actor());
    const paused = await db.select().from(s.alertRules).where(and(eq(s.alertRules.workspaceId, ctx.workspace.id), like(s.alertRules.managedKey, "protect:%")));
    expect(paused.every((r) => r.paused)).toBe(true);
    expect((await protectionStatus(ctx.workspace.id)).enabled).toBe(false);
    await enableProtection(actor());
    const resumed = await db.select().from(s.alertRules).where(and(eq(s.alertRules.workspaceId, ctx.workspace.id), like(s.alertRules.managedKey, "protect:%")));
    expect(resumed.every((r) => !r.paused)).toBe(true);
  });

  async function proteinRows() {
    const protein = (await managedGroups(ctx.workspace.id)).find((g) => g.basis === "per_100g" && !g.archivedAt)!;
    const d = await getGroupDetail(ctx.workspace.id, protein.id);
    return { group: protein, rows: d.items };
  }
  async function eventsOf(type: string, groupId: string) {
    const rules = await db.select({ id: s.alertRules.id }).from(s.alertRules).where(and(eq(s.alertRules.groupId, groupId), eq(s.alertRules.type, type as never)));
    return db.select().from(s.alertEvents).where(inArray(s.alertEvents.ruleId, rules.map((r) => r.id)));
  }

  it("rival_drop_5pct fires once for a ≥5% drop between consecutive observations, with dedupe and cooldown", async () => {
    const { group, rows } = await proteinRows();
    const rival = rows.find((r) => r.role === "competitor" && r.priceMinor !== null)!;
    const base = 100_000;
    await observe(rival.listingId, { priceMinor: base, at: tick() });
    await observe(rival.listingId, { priceMinor: base - 3_000, at: tick() }); // −3%: below threshold
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" });
    expect(await eventsOf("rival_drop_5pct", group.id)).toHaveLength(0);
    await observe(rival.listingId, { priceMinor: 90_000, at: tick() }); // −7.2%
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" });
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" }); // same observation: deduped
    const events = await eventsOf("rival_drop_5pct", group.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.metrics).toMatchObject({ from: 97_000, to: 90_000 });
    // A second qualifying drop inside the 24-hour cooldown is held back.
    await observe(rival.listingId, { priceMinor: 80_000, at: tick() });
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" });
    expect(await eventsOf("rival_drop_5pct", group.id)).toHaveLength(1);
  });

  it("never compares a simulated observation with a verified one, and treats a missing price as missing", async () => {
    const { group, rows } = await proteinRows();
    const rival = rows.filter((r) => r.role === "competitor")[1]!;
    await observe(rival.listingId, { priceMinor: 100_000, at: tick(), isSimulated: true });
    await observe(rival.listingId, { priceMinor: 50_000, at: tick(), isSimulated: false });
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" });
    await observe(rival.listingId, { priceMinor: null, at: tick(), isSimulated: false, availability: "unknown" });
    await evaluateAlertsForListings([rival.listingId], { trigger: "manual" });
    const events = (await eventsOf("rival_drop_5pct", group.id)).filter((e) => e.variantId === rival.variantId);
    expect(events).toHaveLength(0);
  });

  it("reference_out_of_stock fires only on a known in-stock → out-of-stock transition", async () => {
    const { group, rows } = await proteinRows();
    const [mine, mine2] = rows.filter((r) => r.role === "reference");
    // Unknown → out of stock: we never knew it was available, so no alert.
    await observe(mine2!.listingId, { priceMinor: null, availability: "unknown", at: tick() });
    await observe(mine2!.listingId, { priceMinor: null, availability: "out_of_stock", at: tick() });
    await evaluateAlertsForListings([mine2!.listingId], { trigger: "manual" });
    expect((await eventsOf("reference_out_of_stock", group.id)).filter((e) => e.variantId === mine2!.variantId)).toHaveLength(0);
    // In stock → out of stock: fires.
    await observe(mine!.listingId, { priceMinor: 150_000, availability: "in_stock", at: tick() });
    await observe(mine!.listingId, { priceMinor: null, availability: "out_of_stock", at: tick() });
    await evaluateAlertsForListings([mine!.listingId], { trigger: "manual" });
    const ev = (await eventsOf("reference_out_of_stock", group.id)).filter((e) => e.variantId === mine!.variantId);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.isSimulated).toBe(true);
  });

  it("price_leadership_change records the leader first, then fires when another brand takes over", async () => {
    const { group, rows } = await proteinRows();
    const ids = rows.map((r) => r.listingId);
    await evaluateAlertsForListings(ids, { trigger: "manual" }); // establishes the current leader
    const leader = (await getGroupDetail(ctx.workspace.id, group.id)).result.cheapest!;
    const challenger = rows.find((r) => r.brandName !== leader.brandName && r.quantities.length > 0)!;
    await observe(challenger.listingId, { priceMinor: 100, at: tick() }); // absurdly cheap per unit
    await evaluateAlertsForListings(ids, { trigger: "manual" });
    const events = await eventsOf("price_leadership_change", group.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.headline).toContain(challenger.brandName ?? "");
  });

  it("reports status with counts and recent events", async () => {
    const st = await protectionStatus(ctx.workspace.id);
    expect(st.enabled).toBe(true);
    expect(st.brand?.name).toBe("Lumen Nutrition");
    expect(st.rules.find((r) => r.type === "rival_drop_5pct")!.fired).toBeGreaterThanOrEqual(1);
    expect(st.events.length).toBeGreaterThan(0);
  });
});
