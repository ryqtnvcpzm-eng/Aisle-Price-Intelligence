/**
 * End-to-end service journey against a real Postgres (demo provider):
 * import → variants → comparison → alerts → monitoring → reports, plus
 * failure, quota and isolation paths. Mirrors the product brief's test plan.
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlertsForListings } from "@/server/alerts/engine";
import { createRule } from "@/server/alerts/service";
import { commitImport, previewImport } from "@/server/catalog/import";
import { patchVariants, setQuantity } from "@/server/catalog/mutations";
import { writeObservation } from "@/server/catalog/persist";
import { listVariantRows } from "@/server/catalog/queries";
import { getGroupDetail } from "@/server/comparison/service";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { HttpError } from "@/server/errors";
import { computeInsights } from "@/server/insights/engine";
import { checkBudget, pauseProvider } from "@/server/monitoring/budget";
import { writeHeartbeat } from "@/server/monitoring/heartbeat";
import { HEARTBEAT_KEY } from "@/server/monitoring/queue";
import { runRefreshJob } from "@/server/monitoring/refresh";
import { requestManualRefresh } from "@/server/monitoring/scheduler";
import { getProvider } from "@/server/providers";
import type { DemoProvider } from "@/server/providers/demo";
import { buildReport } from "@/server/reports/build";
import { renderReport } from "@/server/reports/render";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";

async function makeContext(name: string): Promise<AppContext> {
  const userId = randomUUID();
  await db.insert(s.user).values({ id: userId, name, email: `${userId}@test.local` });
  const [ws] = await db.insert(s.workspaces).values({ name: `${name} WS`, slug: `t-${userId.slice(0, 8)}`, onboardedAt: new Date() }).returning();
  await db.insert(s.workspaceMembers).values({ workspaceId: ws!.id, userId, role: "owner" });
  return { user: { id: userId, name, email: `${userId}@test.local` }, workspace: ws!, role: "owner" };
}

let ctx: AppContext;
let other: AppContext;
let groupId: string;
let variantIds: string[] = [];

beforeAll(async () => {
  ctx = await makeContext("Analyst");
  other = await makeContext("Stranger");
});

afterAll(async () => {
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

describe("import", () => {
  it("previews a pasted URL with every discovered variant and honest labels", async () => {
    const p = await previewImport(ctx, "https://www.amazon.in/Lumen-Plant-Protein/dp/B0AISLE002?ref_=x", null);
    expect(p.errors).toEqual([]);
    expect(p.families).toHaveLength(1);
    const f = p.families[0]!;
    expect(f).toMatchObject({ marketplace: "IN", marketplaceDetected: true, isSimulated: true, primaryAsin: "B0AISLE002", parentAsin: "B0AISLEP01" });
    expect(f.discovery.completeness).toBe("complete");
    expect(f.variants).toHaveLength(5);
    expect(f.variants.find((v) => v.asin === "B0AISLE002")!.quantity?.totalMilli).toBe(1_000_000);
    expect(f.variants.every((v) => v.priceMinor === null || Number.isInteger(v.priceMinor))).toBe(true);
  });

  it("explains invalid and unsupported inputs instead of failing silently", async () => {
    const p = await previewImport(ctx, "https://example.com/dp/B0AISLE002\nnot-a-link\nhttps://www.amazon.in/s?k=protein", null);
    expect(p.families).toHaveLength(0);
    expect(p.errors.map((e) => e.code).sort()).toEqual(["no_asin", "not_a_url", "unsupported_host"]);
  });

  it("commits selected variants, backfills history and schedules hourly monitoring", async () => {
    const p = await previewImport(ctx, "https://www.amazon.in/dp/B0AISLE002", null);
    const fam = p.families[0]!;
    const r = await commitImport(ctx, { previewId: p.previewId, families: [{ key: fam.key, asins: fam.variants.map((v) => v.asin) }], newGroupName: "Plant Protein — India", intervalMinutes: 60 });
    expect(r.variantIds).toHaveLength(5);
    groupId = r.groupId!;
    variantIds = r.variantIds;
    const rows = await listVariantRows(ctx.workspace.id);
    expect(rows).toHaveLength(5);
    expect(rows.every((x) => x.checkIntervalMinutes === 60 && x.nextCheckAt)).toBe(true);
    expect(rows.every((x) => x.observationCount > 1)).toBe(true); // backfill + import observation
    expect(rows.every((x) => x.brandName === "Lumen Nutrition")).toBe(true);
  });

  it("adds a competitor into the same comparison and dedupes re-imports", async () => {
    const p = await previewImport(ctx, "B0AISLE007 https://www.amazon.in/gp/product/B0AISLE007", "IN");
    expect(p.duplicates).toHaveLength(1);
    const fam = p.families[0]!;
    await commitImport(ctx, { previewId: p.previewId, families: [{ key: fam.key, asins: ["B0AISLE006", "B0AISLE007"] }], groupId, intervalMinutes: 60 });
    // Re-importing an already-tracked listing doesn't duplicate it.
    const again = await previewImport(ctx, "https://www.amazon.in/dp/B0AISLE002", null);
    expect(again.families[0]!.variants.find((v) => v.asin === "B0AISLE002")!.alreadyTracked).toBe(true);
    expect(again.families[0]!.variants.find((v) => v.asin === "B0AISLE002")!.trackedInGroups).toContain("Plant Protein — India");
    await commitImport(ctx, { previewId: again.previewId, families: [{ key: again.families[0]!.key, asins: ["B0AISLE002"] }], intervalMinutes: 60 });
    const n = (await db.select({ n: count() }).from(s.variants).where(eq(s.variants.workspaceId, ctx.workspace.id)))[0]!.n;
    expect(n).toBe(7);
  });

  it("rejects expired or foreign previews", async () => {
    await expect(commitImport(other, { previewId: randomUUID(), families: [{ key: "IN:B0AISLE002", asins: ["B0AISLE002"] }], intervalMinutes: 60 })).rejects.toMatchObject({ status: 410 });
  });
});

describe("comparison", () => {
  it("compares on a normalized basis with reference vs competitors", async () => {
    const d = await getGroupDetail(ctx.workspace.id, groupId);
    expect(d.items).toHaveLength(7);
    expect(d.result.basis).toBe("per_100g");
    expect(d.result.comparableCount).toBeGreaterThanOrEqual(6);
    for (const r of d.result.rows.filter((x) => x.comparable)) expect(Number.isInteger(r.unitPriceMinor)).toBe(true);
    // A manual quantity correction is trusted and changes the unit price.
    const target = d.items.find((i) => i.asin === "B0AISLE006")!;
    await setQuantity(ctx, target.variantId, { dimension: "mass", packCount: 1, unitAmount: 500, unit: "g" });
    const d2 = await getGroupDetail(ctx.workspace.id, groupId);
    const row = d2.items.find((i) => i.variantId === target.variantId)!;
    expect(row.quantities.find((q) => q.dimension === "mass")).toMatchObject({ confidence: "manual", totalMilli: 500_000 });
  });

  it("keeps workspaces isolated", async () => {
    await expect(getGroupDetail(other.workspace.id, groupId)).rejects.toBeInstanceOf(HttpError);
    await expect(patchVariants(other, variantIds.slice(0, 1), { hidden: true })).rejects.toMatchObject({ status: 404 });
    expect(await listVariantRows(other.workspace.id)).toHaveLength(0);
  });
});

describe("monitoring", () => {
  async function jobFor(listingIds: string[]) {
    const [j] = await db.insert(s.monitoringJobs).values({ kind: "manual", provider: "demo", marketplace: "IN", listingIds, idempotencyKey: `test:${randomUUID()}` }).returning();
    return j!.id;
  }

  it("refresh jobs write observations and are idempotent", async () => {
    const rows = await listVariantRows(ctx.workspace.id);
    const ids = rows.map((r) => r.listingId);
    const before = (await db.select({ n: count() }).from(s.priceObservations).where(inArray(s.priceObservations.listingId, ids)))[0]!.n;
    const job = await jobFor(ids);
    const r1 = await runRefreshJob(job, { attempt: 1, final: true });
    expect(r1.status).toBe("succeeded");
    const after = (await db.select({ n: count() }).from(s.priceObservations).where(inArray(s.priceObservations.listingId, ids)))[0]!.n;
    expect(after).toBe(before + ids.length);
    const r2 = await runRefreshJob(job, { attempt: 2, final: true });
    expect(r2.status).toBe("succeeded"); // no-op
    const again = (await db.select({ n: count() }).from(s.priceObservations).where(inArray(s.priceObservations.listingId, ids)))[0]!.n;
    expect(again).toBe(after);
    const fresh = await listVariantRows(ctx.workspace.id);
    expect(fresh.every((v) => v.consecutiveFailures === 0 && v.lastSuccessAt)).toBe(true);
  });

  it("runs a manual refresh inline when no queue worker is alive, and queues it when one is", async () => {
    const rows = await listVariantRows(ctx.workspace.id);
    const [l] = await db.select().from(s.listings).where(eq(s.listings.id, rows[0]!.listingId));
    const listingRows = [{ id: l!.id, provider: l!.provider, marketplace: l!.marketplace }];
    if (redisConfigured()) await getRedis().del(HEARTBEAT_KEY);

    // No heartbeat: a queued job would never run, so the refresh happens now.
    const [inline] = await requestManualRefresh({ workspaceId: ctx.workspace.id, userId: ctx.user.id, listingRows });
    const [done] = await db.select().from(s.monitoringJobs).where(eq(s.monitoringJobs.id, inline!));
    expect(done!.status).toBe("succeeded");

    if (redisConfigured()) {
      // A live worker: the job goes to the queue instead (the minute-bucketed key would dedupe, so use another listing).
      await writeHeartbeat("queue", 90);
      const [l2] = await db.select().from(s.listings).where(eq(s.listings.id, rows[1]!.listingId));
      const [queued] = await requestManualRefresh({ workspaceId: ctx.workspace.id, userId: ctx.user.id, listingRows: [{ id: l2!.id, provider: l2!.provider, marketplace: l2!.marketplace }] });
      const [job] = await db.select().from(s.monitoringJobs).where(eq(s.monitoringJobs.id, queued!));
      expect(job!.status).toBe("queued");
      await getRedis().del(HEARTBEAT_KEY);
    }
  });

  it("retries transient failures and backs off on the final attempt", async () => {
    const rows = await listVariantRows(ctx.workspace.id);
    const id = rows[0]!.listingId;
    const demo = getProvider("demo") as DemoProvider;
    demo.simulateFailure("upstream");
    await expect(runRefreshJob(await jobFor([id]), { attempt: 1, final: false })).rejects.toMatchObject({ kind: "upstream" });
    demo.simulateFailure("upstream");
    const job = await jobFor([id]);
    expect((await runRefreshJob(job, { attempt: 4, final: true })).status).toBe("failed");
    const [l] = await db.select().from(s.listings).where(eq(s.listings.id, id));
    expect(l!.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(l!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000); // exponential backoff
    const [j] = await db.select().from(s.monitoringJobs).where(eq(s.monitoringJobs.id, job));
    expect(j!.status).toBe("failed");
  });

  it("budget guard pauses polling when the provider is exhausted", async () => {
    await pauseProvider("demo", new Date(Date.now() + 10 * 60_000));
    const d = await checkBudget("demo", 5);
    expect(d.allowed).toBe(false);
    expect(d.retryAt).not.toBeNull();
    await pauseProvider("demo", new Date(Date.now() - 1000));
    expect((await checkBudget("demo", 5)).allowed).toBe(true);
  });
});

describe("alerts", () => {
  it("fires once on a qualifying drop, then dedupes", async () => {
    const rule = await createRule(ctx, { name: "Drop ≥ 5%", type: "pct_drop", groupId, params: { pct: 5 }, frequency: "instant", channels: ["in_app"], cooldownMinutes: 60 });
    const rows = await listVariantRows(ctx.workspace.id);
    const v = rows.find((r) => r.asin === "B0AISLE007")!;
    await writeObservation(db, v.listingId, "IN", {
      observedAt: new Date(Date.now() + 1000),
      currency: "INR",
      priceMinor: Math.round((v.priceMinor! * 0.8) / 100) * 100,
      priceBasis: "buy_box",
      amazonPriceMinor: null,
      lowestNewPriceMinor: null,
      listPriceMinor: v.listPriceMinor,
      dealPriceMinor: null,
      primeExclusivePriceMinor: null,
      shippingMinor: 0,
      availability: "in_stock",
      seller: null,
    }, { provider: "demo", source: "manual", requestedAt: new Date(), providerUpdatedAt: new Date(), isSimulated: true });
    await evaluateAlertsForListings([v.listingId], { trigger: "manual" });
    await evaluateAlertsForListings([v.listingId], { trigger: "manual" });
    const events = await db.select().from(s.alertEvents).where(eq(s.alertEvents.ruleId, rule.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.isSimulated).toBe(true);
    expect(events[0]!.deliveredChannels).toEqual(["in_app"]); // simulated data is never emailed
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.workspaceId, ctx.workspace.id), eq(s.notifications.alertEventId, events[0]!.id)));
    expect(notes).toHaveLength(1);
  });

  it("validates rule scope", async () => {
    await expect(createRule(ctx, { name: "x", type: "competitor_undercut", params: {}, frequency: "instant", channels: ["in_app"], cooldownMinutes: 60 })).rejects.toMatchObject({ status: 400 });
    await expect(createRule(other, { name: "x", type: "pct_drop", groupId, params: { pct: 5 }, frequency: "instant", channels: ["in_app"], cooldownMinutes: 60 })).rejects.toMatchObject({ status: 404 });
  });
});

describe("insights & reports", () => {
  it("computes insights from stored data", async () => {
    const ins = await computeInsights(ctx.workspace.id);
    expect(Array.isArray(ins)).toBe(true);
    for (const i of ins) expect(i.evidence.length).toBeGreaterThan(0);
  });

  it("exports a comparison report in every format, labelled simulated", async () => {
    const data = await buildReport(ctx.workspace.id, { type: "competitive_snapshot", groupId, format: "pdf" });
    expect(data.containsSimulated).toBe(true);
    expect(data.sections[1]!.rows.length).toBe(7);
    for (const f of ["csv", "xlsx", "pdf"] as const) {
      const out = await renderReport(data, f);
      expect(out.body.length).toBeGreaterThan(200);
    }
    const csv = (await renderReport(data, "csv")).body.toString("utf8");
    expect(csv).toContain("SIMULATED");
    expect(csv).toContain("Unit price (/100 g) (major units)");
  });

  it("change log and history reports never fill gaps", async () => {
    const log = await buildReport(ctx.workspace.id, { type: "change_log", format: "csv" });
    expect(log.methodology.join(" ")).toMatch(/can't be seen/);
    const hist = await buildReport(ctx.workspace.id, { type: "price_history", format: "csv" });
    for (const r of hist.sections[0]!.rows) expect(Number(r.coverage)).toBeLessThanOrEqual(1);
  });
});
