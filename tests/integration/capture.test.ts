/**
 * Price capture: tokens, recording a captured price as a verified observation,
 * and the provenance rules that keep captured and simulated prices apart.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateAlertsForListings } from "@/server/alerts/engine";
import { createRule } from "@/server/alerts/service";
import { getHistory } from "@/server/analytics/history";
import { captureSchema, recordCapture, type CaptureInput } from "@/server/capture/service";
import { captureTokenStatus, generateCaptureToken, hashToken, verifyCaptureToken } from "@/server/capture/tokens";
import { writeObservation } from "@/server/catalog/persist";
import { listVariantRows } from "@/server/catalog/queries";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { importFamily, makeContext, restoreObservedListings, touchListing } from "../support/fixtures";

let ctx: AppContext;
let other: AppContext;
let groupId: string;
let row: Awaited<ReturnType<typeof listVariantRows>>[number];
let clock = Date.now() + 120_000;
const tick = () => new Date((clock += 60_000));
const capture = (o: Partial<CaptureInput> = {}): CaptureInput => captureSchema.parse({ asin: row.asin, title: "Lumen Plant Protein 1 kg", priceMinor: 129_900, currency: "INR", url: `https://www.amazon.in/dp/${row.asin}`, variantLabel: "1 kg · Chocolate", availability: "In stock", capturedAt: new Date().toISOString(), selector: "#corePrice_feature_div .a-offscreen", isDeal: false, ...o });

beforeAll(async () => {
  ctx = await makeContext("Capturer");
  other = await makeContext("Other team");
  const r = await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE002");
  const [g] = await db.insert(s.comparisonGroups).values({ workspaceId: ctx.workspace.id, name: "Captured group", basis: "per_100g" }).returning();
  groupId = g!.id;
  await db.insert(s.comparisonItems).values(r.variantIds.map((variantId) => ({ groupId, variantId })));
  row = (await listVariantRows(ctx.workspace.id)).find((x) => x.asin === "B0AISLE002")!;
  touchListing(row.listingId);
});
afterAll(async () => {
  await restoreObservedListings();
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

describe("capture tokens", () => {
  it("stores only a SHA-256 hash, verifies, and stops the old token working when regenerated", async () => {
    const a = await generateCaptureToken(ctx);
    expect(a.token).toMatch(/^aisle_cap_[A-Za-z0-9_-]{43}$/); // 32 random bytes
    const stored = await db.select().from(s.apiTokens).where(eq(s.apiTokens.userId, ctx.user.id));
    expect(stored.every((t) => t.tokenHash !== a.token && !t.tokenHash.includes(a.token))).toBe(true);
    expect(stored.find((t) => !t.revokedAt)!.tokenHash).toBe(hashToken(a.token));
    expect((await verifyCaptureToken(a.token)).ctx.workspace.id).toBe(ctx.workspace.id);
    const b = await generateCaptureToken(ctx);
    await expect(verifyCaptureToken(a.token)).rejects.toMatchObject({ status: 401 });
    expect((await verifyCaptureToken(b.token)).ctx.user.id).toBe(ctx.user.id);
    expect((await captureTokenStatus(ctx))!.prefix).toBe(b.token.slice(0, 14));
    await expect(verifyCaptureToken("aisle_cap_" + "x".repeat(43))).rejects.toMatchObject({ status: 401 });
    await expect(verifyCaptureToken("not-a-token")).rejects.toMatchObject({ status: 401 });
  });

  it("refuses tokens for viewers", async () => {
    await expect(generateCaptureToken({ ...ctx, role: "viewer" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("validation", () => {
  it("rejects malformed captures", () => {
    const base = { asin: "B0AISLE002", priceMinor: 100, currency: "INR", url: "https://www.amazon.in/dp/B0AISLE002", capturedAt: new Date().toISOString() };
    expect(captureSchema.safeParse(base).success).toBe(true);
    expect(captureSchema.safeParse({ ...base, asin: "b0aisle002" }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, asin: "B0AISLE02" }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, priceMinor: -1 }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, priceMinor: 12.5 }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, priceMinor: null }).success).toBe(true);
    expect(captureSchema.safeParse({ ...base, url: "https://www.amazon.com/dp/B0AISLE002" }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, url: "https://evil.example/?https://www.amazon.in/" }).success).toBe(false);
    expect(captureSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  });
});

describe("recording captures", () => {
  it("records a verified observation and makes it the current price", async () => {
    const at = new Date();
    const r = await recordCapture(ctx, capture({ capturedAt: at.toISOString(), isDeal: true }));
    expect(r).toMatchObject({ status: "recorded", variantId: row.variantId });
    const [obs] = await db.select().from(s.priceObservations).where(and(eq(s.priceObservations.listingId, row.listingId), eq(s.priceObservations.source, "user-capture")));
    expect(obs).toMatchObject({ provider: "capture", isSimulated: false, priceMinor: 129_900, dealPriceMinor: 129_900, availability: "in_stock" });
    expect(obs!.providerUpdatedAt!.toISOString()).toBe(at.toISOString());
    const fresh = (await listVariantRows(ctx.workspace.id)).find((x) => x.variantId === row.variantId)!;
    expect(fresh).toMatchObject({ priceMinor: 129_900, priceSource: "user-capture", priceIsSimulated: false, isSimulated: true });
    // Period changes only compare like with like: there's no captured price 24 h ago, so no change is claimed.
    expect(fresh.p24).toBeNull();
  });

  it("ignores a double click", async () => {
    const before = await db.select().from(s.priceObservations).where(and(eq(s.priceObservations.listingId, row.listingId), eq(s.priceObservations.source, "user-capture")));
    const r = await recordCapture(ctx, capture());
    expect(r.status).toBe("duplicate");
    const after = await db.select().from(s.priceObservations).where(and(eq(s.priceObservations.listingId, row.listingId), eq(s.priceObservations.source, "user-capture")));
    expect(after).toHaveLength(before.length);
  });

  it("never lets a later simulated reading replace the captured price", async () => {
    await writeObservation(db, row.listingId, "IN", { observedAt: tick(), currency: "INR", priceMinor: 99_900, priceBasis: "buy_box", amazonPriceMinor: null, lowestNewPriceMinor: null, listPriceMinor: null, dealPriceMinor: null, primeExclusivePriceMinor: null, shippingMinor: 0, availability: "in_stock", seller: null }, { provider: "demo", source: "poll", requestedAt: new Date(), providerUpdatedAt: new Date(), isSimulated: true });
    const [l] = await db.select().from(s.listings).where(eq(s.listings.id, row.listingId));
    expect(l).toMatchObject({ currentPriceMinor: 129_900, currentSource: "user-capture", currentIsSimulated: false });
  });

  it("never compares a captured price with a simulated one in alerts", async () => {
    const rule = await createRule(ctx, { name: "Any 5% drop", type: "pct_drop", groupId, params: { pct: 5 }, frequency: "instant", channels: ["in_app"], cooldownMinutes: 60 });
    // Captured 99,900 after a simulated reading: a 'drop' only if you mix sources.
    await recordCapture(ctx, capture({ priceMinor: 89_900, capturedAt: new Date().toISOString() }));
    await evaluateAlertsForListings([row.listingId], { trigger: "manual" });
    expect(await db.select().from(s.alertEvents).where(eq(s.alertEvents.ruleId, rule.id))).toHaveLength(0);
  });

  it("uses the server's clock when the browser's is implausible", async () => {
    const r = await recordCapture(ctx, capture({ priceMinor: 88_800, capturedAt: "2030-01-01T00:00:00.000Z" }));
    expect(Math.abs(Date.parse((r as { observedAt: string }).observedAt) - Date.now())).toBeLessThan(5_000);
  });

  it("records availability without a price, and keeps unclear text as unknown", async () => {
    await recordCapture(ctx, capture({ priceMinor: null, selector: null, availability: "Currently unavailable." }));
    let [l] = await db.select().from(s.listings).where(eq(s.listings.id, row.listingId));
    expect(l).toMatchObject({ currentPriceMinor: null, availability: "out_of_stock", currentSource: "user-capture" });
    await recordCapture(ctx, capture({ priceMinor: 87_700, availability: "Usually dispatched in 3 days." }));
    [l] = await db.select().from(s.listings).where(eq(s.listings.id, row.listingId));
    expect(l!.availability).toBe("unknown");
  });

  it("answers untracked ASINs with an import link, and keeps workspaces apart", async () => {
    const r = await recordCapture(ctx, capture({ asin: "B0ZZZZZZZZ", url: "https://www.amazon.in/dp/B0ZZZZZZZZ" }));
    expect(r).toMatchObject({ status: "untracked", asin: "B0ZZZZZZZZ" });
    expect((r as { importUrl: string }).importUrl).toContain("/products?import=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB0ZZZZZZZZ");
    // Another workspace capturing the same ASIN doesn't reach this workspace's product.
    const theirs = await recordCapture(other, capture());
    expect(theirs.status).toBe("untracked");
    const logged = await db.select().from(s.priceCaptures).where(eq(s.priceCaptures.workspaceId, ctx.workspace.id));
    expect(logged.map((c) => c.status)).toEqual(expect.arrayContaining(["recorded", "duplicate", "untracked"]));
  });

  it("shows captures as their own points in history, apart from the provider line", async () => {
    const h = await getHistory(ctx.workspace.id, [row.variantId], new Date(Date.now() - 86_400_000), new Date(Date.now() + 86_400_000 * 2));
    const series = h[0]!;
    expect(series.captures.length).toBeGreaterThanOrEqual(4);
    expect(series.captures.every((c) => typeof c.t === "number")).toBe(true);
    expect(series.raw.some((p) => p.price === 89_900)).toBe(false); // the provider line has no captured values
  });
});
