/**
 * Monday Briefing against hand-placed observations in a past week that has no
 * other data (well before the demo backfill), so every number is predictable.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, lastCompletedWeek, weekStarting, type Week } from "@/lib/week";
import { setReferenceBrand } from "@/server/brand/reference";
import { ensureBriefing, listBriefings } from "@/server/briefing/service";
import { listVariantRows } from "@/server/catalog/queries";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { importFamily, makeContext, observe, restoreObservedListings } from "../support/fixtures";

let ctx: AppContext;
let week: Week;
const H = 3_600_000;
const D = 24 * H;
const at = (ms: number) => new Date(week.periodStart.getTime() + ms);

beforeAll(async () => {
  ctx = await makeContext("Briefing reader", { timeZone: "Asia/Kolkata" });
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE002"); // Lumen plant protein
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE007"); // Northfield pea protein
  await setReferenceBrand({ workspaceId: ctx.workspace.id, userId: ctx.user.id }, { brandName: "Lumen Nutrition" });
  week = weekStarting(addDays(lastCompletedWeek("Asia/Kolkata").weekStart, -7 * 30), "Asia/Kolkata");

  const rows = await listVariantRows(ctx.workspace.id);
  const l1 = rows.find((r) => r.asin === "B0AISLE002")!;
  const n1 = rows.find((r) => r.asin === "B0AISLE007")!;
  const n2 = rows.find((r) => r.asin === "B0AISLE008")!;
  // Lumen 1 kg: −10% mid-week (a mover and a ≥5% drop).
  await observe(l1.listingId, { priceMinor: 100_000, at: at(-H), isSimulated: false });
  await observe(l1.listingId, { priceMinor: 90_000, at: at(2 * D), isSimulated: false });
  await observe(l1.listingId, { priceMinor: 90_000, at: at(5 * D), isSimulated: false }); // keeps it fresh (< 72 h) at week's end
  // Northfield: exactly −5% (included), then unchanged.
  await observe(n1.listingId, { priceMinor: 80_000, at: at(-H), isSimulated: false });
  await observe(n1.listingId, { priceMinor: 76_000, at: at(3 * D), isSimulated: false });
  await observe(n1.listingId, { priceMinor: 76_000, at: at(4 * D), isSimulated: false });
  await observe(n1.listingId, { priceMinor: 76_000, at: at(6 * D), isSimulated: false });
  // A verified price followed by a simulated one: never compared.
  await observe(n2.listingId, { priceMinor: 50_000, at: at(-H), isSimulated: false });
  await observe(n2.listingId, { priceMinor: 40_000, at: at(1 * D), isSimulated: true });
});

afterAll(async () => {
  await restoreObservedListings();
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

describe("Monday Briefing", () => {
  it("covers Monday 00:00 to Monday 00:00 in the workspace's time zone", async () => {
    const { briefing, created } = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart });
    expect(created).toBe(true);
    expect(briefing.timeZone).toBe("Asia/Kolkata");
    expect(briefing.periodStart.toISOString().endsWith("T18:30:00.000Z")).toBe(true);
    expect(briefing.content.week).toMatchObject({ start: week.weekStart, end: addDays(week.weekStart, 6) });
  });

  it("measures moves and drops only between comparable observations", async () => {
    const { briefing } = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart });
    const c = briefing.content;
    expect(c.summary.observations).toBe(6); // the in-week observations only
    expect(c.summary.priceChanges).toBe(2);
    expect(c.movers.down.map((m) => [m.listing.brandName, Math.round(m.ratio * 100)])).toEqual([
      ["Lumen Nutrition", -10],
      ["Northfield Labs", -5],
    ]);
    expect(c.movers.down[0]!.listing.isReference).toBe(true);
    expect(c.drops).toHaveLength(2); // the verified → simulated change is not a drop
    expect(c.drops.every((d) => d.listing.name.length > 0)).toBe(true);
    expect(briefing.containsSimulated).toBe(true);
  });

  it("reports missing data as missing, never zero", async () => {
    const { briefing } = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart });
    const c = briefing.content;
    expect(c.confidence.trackedListings).toBe(9);
    expect(c.confidence.listingsWithObservations).toBe(3);
    expect(c.confidence.staleAtEnd).toBeGreaterThanOrEqual(6);
    expect(c.confidence.notes.join(" ")).toMatch(/missing, not zero/);
    // Daily index: day 0 has both brands; values come from observed prices only.
    expect(c.trend).toHaveLength(7);
    expect(c.trend[0]!.reference).toBe(100);
    expect(c.trend[6]!.reference).toBe(90);
    expect(c.trend[6]!.competitors).toBe(95);
    for (const d of c.trend) for (const v of [d.reference, d.competitors]) if (v !== null) expect(v).toBeGreaterThan(0);
  });

  it("places the reference brand in each managed comparison at the start and end of the week", async () => {
    const { briefing } = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart });
    const p = briefing.content.position.find((x) => x.basis === "per_100g")!;
    expect(p.name).toContain("Lumen Nutrition vs Market");
    expect(p.start?.comparable).toBeGreaterThanOrEqual(2);
    expect(p.end?.premium).not.toBeNull();
    expect(briefing.content.summary.sentences.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent, and rebuilds in place on request", async () => {
    const a = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart });
    expect(a.created).toBe(false);
    const forced = await ensureBriefing(ctx.workspace.id, { weekStart: week.weekStart, force: true });
    expect(forced.briefing.id).toBe(a.briefing.id);
    expect(forced.briefing.version).toBe(a.briefing.version + 1);
    const rows = await db.select().from(s.briefings).where(and(eq(s.briefings.workspaceId, ctx.workspace.id), eq(s.briefings.weekStart, week.weekStart)));
    expect(rows).toHaveLength(1);
    expect((await listBriefings(ctx.workspace.id)).map((b) => b.weekStart)).toContain(week.weekStart);
  });

  it("refuses a week that hasn't finished", async () => {
    const thisWeek = addDays(lastCompletedWeek("Asia/Kolkata").weekStart, 7);
    await expect(ensureBriefing(ctx.workspace.id, { weekStart: thisWeek })).rejects.toMatchObject({ status: 400 });
  });
});
