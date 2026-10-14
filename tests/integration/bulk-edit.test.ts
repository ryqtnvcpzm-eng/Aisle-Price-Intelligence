/** Bulk editing: every requested id is accounted for as updated, skipped or failed, with a reason. */
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getReferenceBrand, setReferenceBrand } from "@/server/brand/reference";
import { applyTagEdit, bulkEdit } from "@/server/catalog/bulk";
import { listVariantRows } from "@/server/catalog/queries";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { importFamily, makeContext } from "../support/fixtures";

let ctx: AppContext;
let other: AppContext;
let familyIds: string[] = [];
const accounted = (r: { requested: number; updated: number; skipped: unknown[]; failed: unknown[] }) => r.updated + r.skipped.length + r.failed.length;

beforeAll(async () => {
  ctx = await makeContext("Bulk editor");
  other = await makeContext("Outsider");
  const a = await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE002");
  const b = await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE011");
  familyIds = [...a.familyIds, ...b.familyIds];
});
afterAll(async () => {
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

describe("bulk edit", () => {
  it("changes the brand, skipping products that already have it and failing foreign ids", async () => {
    const foreign = (await importFamily(other, "https://www.amazon.in/dp/B0AISLE007")).familyIds[0]!;
    const r = await bulkEdit(ctx, { action: "brand", familyIds: [...familyIds, familyIds[0]!, foreign], brandName: "House Label" });
    expect(r).toMatchObject({ requested: 3, updated: 2 });
    expect(r.failed).toEqual([{ id: foreign, label: foreign, reason: "Not found in this workspace" }]);
    expect(accounted(r)).toBe(r.requested);
    const again = await bulkEdit(ctx, { action: "brand", familyIds, brandName: "house label" }); // same slug → same brand
    expect(again.updated).toBe(0);
    expect(again.skipped.map((x) => x.reason)).toEqual(["Already House Label", "Already House Label"]);
    // The foreign workspace's product is untouched.
    const [f] = await db.select().from(s.productFamilies).where(eq(s.productFamilies.id, foreign));
    const [ob] = await db.select().from(s.brands).where(eq(s.brands.id, f!.brandId!));
    expect(ob!.name).toBe("Northfield Labs");
  });

  it("re-reconciles the managed comparisons when the reference brand gains products", async () => {
    await setReferenceBrand({ workspaceId: ctx.workspace.id, userId: ctx.user.id }, { brandName: "Pureform" });
    const before = await db.select().from(s.comparisonGroups).where(eq(s.comparisonGroups.workspaceId, ctx.workspace.id));
    expect(before.filter((g) => g.managedBy && !g.archivedAt)).toHaveLength(0); // Pureform has no products now
    await bulkEdit(ctx, { action: "brand", familyIds: [familyIds[1]!], brandName: "Pureform" });
    expect((await getReferenceBrand(ctx.workspace.id))!.name).toBe("Pureform");
    const after = await db.select().from(s.comparisonGroups).where(eq(s.comparisonGroups.workspaceId, ctx.workspace.id));
    expect(after.filter((g) => g.managedBy && !g.archivedAt).length).toBeGreaterThan(0);
  });

  it("sets monitoring frequency, reschedules listings and explains skips", async () => {
    const rows = await listVariantRows(ctx.workspace.id);
    const ids = rows.map((r) => r.variantId);
    await db.update(s.variants).set({ tracked: false }).where(eq(s.variants.id, ids[0]!));
    const r = await bulkEdit(ctx, { action: "frequency", variantIds: ids, intervalMinutes: 360 });
    expect(r.requested).toBe(ids.length);
    expect(r.updated).toBe(ids.length - 1);
    expect(r.skipped).toEqual([expect.objectContaining({ id: ids[0], reason: "Not tracked" })]);
    const variantRows = await db.select().from(s.variants).where(inArray(s.variants.id, ids.slice(1)));
    expect(variantRows.every((v) => v.intervalMinutes === 360)).toBe(true);
    // Listings are shared: each is polled at the most frequent schedule any workspace asks for.
    const listingRows = await db.select().from(s.listings).where(inArray(s.listings.id, rows.slice(1).map((x) => x.listingId)));
    expect(listingRows.every((l) => l.checkIntervalMinutes !== null && l.checkIntervalMinutes <= 360)).toBe(true);
    const again = await bulkEdit(ctx, { action: "frequency", variantIds: ids.slice(1), intervalMinutes: 360 });
    expect(again.updated).toBe(0);
    expect(again.skipped.every((x) => x.reason === "Already every 6 hours")).toBe(true);
    const paused = await bulkEdit(ctx, { action: "frequency", variantIds: ids.slice(1, 3), intervalMinutes: null });
    expect(paused.updated).toBe(2);
    await db.update(s.variants).set({ tracked: true }).where(eq(s.variants.id, ids[0]!));
  });

  it("adds, removes and replaces tags with de-duplication and a limit", async () => {
    let r = await bulkEdit(ctx, { action: "tags", familyIds, mode: "add", tags: ["Launch", "launch", " Q4 "] });
    expect(r.updated).toBe(2);
    let fams = await db.select().from(s.productFamilies).where(inArray(s.productFamilies.id, familyIds));
    expect(fams.every((f) => f.tags.join(",") === "Launch,Q4")).toBe(true);
    r = await bulkEdit(ctx, { action: "tags", familyIds, mode: "add", tags: ["q4"] });
    expect(r.skipped).toHaveLength(2);
    r = await bulkEdit(ctx, { action: "tags", familyIds, mode: "remove", tags: ["LAUNCH"] });
    fams = await db.select().from(s.productFamilies).where(inArray(s.productFamilies.id, familyIds));
    expect(fams.every((f) => f.tags.join(",") === "Q4")).toBe(true);
    r = await bulkEdit(ctx, { action: "tags", familyIds, mode: "add", tags: Array.from({ length: 12 }, (_, i) => `t${i}`) });
    expect(r.failed).toHaveLength(2);
    expect(r.failed[0]!.reason).toMatch(/limit is 12/);
    r = await bulkEdit(ctx, { action: "tags", familyIds, mode: "replace", tags: [] });
    expect(r.updated).toBe(2);
    expect(accounted(r)).toBe(r.requested);
  });

  it("applies tag edits predictably", () => {
    expect(applyTagEdit(["A", "b"], "add", ["B", "c"])).toEqual(["A", "b", "c"]);
    expect(applyTagEdit(["A", "b"], "remove", ["a"])).toEqual(["b"]);
    expect(applyTagEdit(["A"], "replace", ["x", "X"])).toEqual(["x"]);
  });
});
