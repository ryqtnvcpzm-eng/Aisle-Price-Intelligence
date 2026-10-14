/**
 * Seed the demo workspace with the fictional catalog and simulated history.
 *
 *   pnpm db:seed            # idempotent: skips if the demo account exists
 *   pnpm db:seed --force    # wipe the demo workspace and reseed
 *
 * Every listing, observation, alert and activity row created here is flagged
 * `is_simulated`. Sampling cadence mimics a real deployment (hourly recently,
 * sparser further back) and includes a couple of deliberate monitoring gaps
 * so gap-aware charts and statistics have something honest to show.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { detectEvents } from "../src/lib/analytics";
import { formatMoney, formatPct } from "../src/lib/money";
import { reconcileReferenceMarket } from "../src/server/brand/reference";
import { ensureBriefing } from "../src/server/briefing/service";
import { quantitiesFor, variantLabel } from "../src/server/catalog/normalize";
import { db, sqlClient } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { DEMO_FAMILIES, DEMO_REFERENCE_BRAND } from "../src/server/providers/demo/catalog";
import { demoProductAt, demoSnapshotAt } from "../src/server/providers/demo";
import { hash32 } from "../src/server/providers/demo/simulate";

const DEMO_EMAIL = "demo@aisle.app";
const DEMO_PASSWORD = "aisle-demo-2026";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function slugify(x: string) {
  return x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Observation timestamps: hourly for 7d, 3-hourly to 30d, 12-hourly to 120d (with jitter). */
function sampleTimes(now: number, asin: string): number[] {
  const out: number[] = [];
  const jitter = (t: number) => t - (hash32(`${asin}:${t}`) % (6 * 60_000));
  for (let t = now - 120 * DAY; t < now - 30 * DAY; t += 12 * HOUR) out.push(jitter(t));
  for (let t = now - 30 * DAY; t < now - 7 * DAY; t += 3 * HOUR) out.push(jitter(t));
  for (let t = now - 7 * DAY; t <= now - 20 * 60_000; t += HOUR) out.push(jitter(t));
  // Two listings get a simulated outage (refresh failures) ~2 days ago.
  const h = hash32(asin) % 9;
  if (h === 0 || h === 4) return out.filter((t) => t < now - 62 * HOUR || t > now - 47 * HOUR);
  return out;
}

async function wipe(workspaceId: string, userId: string) {
  await db.delete(s.workspaces).where(eq(s.workspaces.id, workspaceId));
  await db.delete(s.user).where(eq(s.user.id, userId));
  // Simulated catalog rows no other workspace still tracks.
  await db.execute(sql`delete from listings l where l.is_simulated and not exists (select 1 from variants v where v.listing_id = l.id)`);
}

async function main() {
  const force = process.argv.includes("--force");
  const [existing] = await db.select().from(s.user).where(eq(s.user.email, DEMO_EMAIL));
  if (existing) {
    const [m] = await db.select().from(s.workspaceMembers).where(eq(s.workspaceMembers.userId, existing.id));
    if (!force) {
      console.log("✓ demo account already seeded (use --force to reseed)");
      return;
    }
    if (m) await wipe(m.workspaceId, existing.id);
    else await db.delete(s.user).where(eq(s.user.id, existing.id));
  }
  const started = Date.now();
  const now = Date.now();

  // ── Account & workspace ────────────────────────────────────────────────
  const userId = randomUUID();
  await db.insert(s.user).values({ id: userId, name: "Demo Analyst", email: DEMO_EMAIL, emailVerified: true });
  await db.insert(s.account).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password: await hashPassword(DEMO_PASSWORD) });
  const [ws] = await db
    .insert(s.workspaces)
    .values({ name: "Lumen Nutrition (demo)", slug: `demo-${Math.random().toString(36).slice(2, 7)}`, defaultMarketplace: "IN", timeZone: "Asia/Kolkata", onboardedAt: new Date() })
    .returning();
  await db.insert(s.workspaceMembers).values({ workspaceId: ws!.id, userId, role: "owner" });

  // ── Catalog ────────────────────────────────────────────────────────────
  const brandIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();
  const variantByAsin = new Map<string, { variantId: string; listingId: string; familyId: string; brand: string; label: string; title: string; marketplace: string }>();
  let obsCount = 0;

  for (const fam of DEMO_FAMILIES) {
    if (!brandIds.has(fam.brand)) {
      const [b] = await db.insert(s.brands).values({ workspaceId: ws!.id, name: fam.brand, slug: slugify(fam.brand), isReference: fam.brand === DEMO_REFERENCE_BRAND }).returning();
      brandIds.set(fam.brand, b!.id);
    }
    const catName = fam.category.at(-1)!;
    if (!categoryIds.has(catName)) {
      const [c] = await db.insert(s.categories).values({ workspaceId: ws!.id, name: catName, slug: slugify(catName) }).returning();
      categoryIds.set(catName, c!.id);
    }
    const visible = fam.partialDiscovery ? fam.variants.slice(0, -1) : fam.variants;
    const [familyRow] = await db
      .insert(s.productFamilies)
      .values({
        workspaceId: ws!.id,
        marketplace: fam.marketplace,
        familyKey: fam.parentAsin ?? fam.variants[0]!.asin,
        parentAsin: fam.parentAsin,
        title: fam.title,
        brandId: brandIds.get(fam.brand),
        categoryId: categoryIds.get(catName),
        imageUrl: `/demo-images/${fam.variants[0]!.asin}.svg`,
        variationDimensions: fam.dimensions,
        discoveryStatus: fam.partialDiscovery ? "partial" : fam.variants.length === 1 && !fam.parentAsin ? "single" : "complete",
        discoveredCount: visible.length,
        provider: "demo",
        isSimulated: true,
        favorite: fam.brand === DEMO_REFERENCE_BRAND && fam.key === "lumen-plant-protein",
        createdAt: new Date(now - 120 * DAY),
      })
      .returning();

    for (const v of visible) {
      const product = demoProductAt(v.asin, fam.marketplace, new Date(now - 20 * 60_000));
      const h = hash32(v.asin) % 9;
      const failing = h === 4; // one listing currently failing refreshes
      const [listing] = await db
        .insert(s.listings)
        .values({
          marketplace: fam.marketplace,
          asin: v.asin,
          parentAsin: fam.parentAsin,
          title: product.title,
          brandName: fam.brand,
          imageUrl: product.imageUrl,
          categoryPath: fam.category,
          variationAttributes: product.variationAttributes,
          sizeText: v.sizeText,
          provider: "demo",
          isSimulated: true,
          checkIntervalMinutes: 60,
          nextCheckAt: new Date(now + ((hash32(v.asin) % 50) + 5) * 60_000),
          lastSuccessAt: failing ? new Date(now - 3 * HOUR) : new Date(now - 20 * 60_000),
          lastRequestedAt: new Date(now - 20 * 60_000),
          lastFailureAt: failing ? new Date(now - 20 * 60_000) : null,
          lastError: failing ? "The data provider returned an error. We'll try again shortly. (simulated)" : null,
          consecutiveFailures: failing ? 3 : 0,
          providerUpdatedAt: product.providerUpdatedAt,
        })
        .onConflictDoUpdate({ target: [s.listings.marketplace, s.listings.asin], set: { checkIntervalMinutes: 60, updatedAt: new Date() } })
        .returning();

      // Sampled observations.
      const times = sampleTimes(now, v.asin);
      const rows = times.map((t) => {
        const snap = demoSnapshotAt(v.asin, fam.marketplace, new Date(t));
        return {
          listingId: listing!.id,
          provider: "demo",
          source: "poll" as const,
          observedAt: new Date(t),
          capturedAt: new Date(t + 4000),
          requestedAt: new Date(t - 2000),
          providerUpdatedAt: new Date(t - ((hash32(`${v.asin}${t}`) % 50) + 5) * 60_000),
          currency: snap.currency,
          priceMinor: snap.priceMinor,
          priceBasis: snap.priceBasis,
          amazonPriceMinor: snap.amazonPriceMinor,
          lowestNewPriceMinor: snap.lowestNewPriceMinor,
          listPriceMinor: snap.listPriceMinor,
          dealPriceMinor: snap.dealPriceMinor,
          shippingMinor: snap.shippingMinor,
          availability: snap.availability,
          sellerIsAmazon: snap.seller?.isAmazon ?? null,
          isSimulated: true,
        };
      });
      for (let i = 0; i < rows.length; i += 1000) await db.insert(s.priceObservations).values(rows.slice(i, i + 1000)).onConflictDoNothing();
      obsCount += rows.length;
      const last = rows.at(-1)!;
      const lastChange = [...rows].reverse().find((r, i, arr) => arr[i + 1] && arr[i + 1]!.priceMinor !== r.priceMinor);
      await db
        .update(s.listings)
        .set({ currentPriceMinor: last.priceMinor, currentPriceBasis: last.priceBasis, listPriceMinor: last.listPriceMinor, availability: last.availability, currency: last.currency, lastObservedAt: last.observedAt, lastPriceChangeAt: lastChange?.observedAt ?? null, buyBoxIsAmazon: last.sellerIsAmazon })
        .where(eq(s.listings.id, listing!.id));
      const sellerRow = fam.seller;
      const [seller] = await db.insert(s.sellers).values({ marketplace: fam.marketplace, sellerId: sellerRow.id, name: sellerRow.name, isAmazon: sellerRow.isAmazon }).onConflictDoUpdate({ target: [s.sellers.marketplace, s.sellers.sellerId], set: { name: sellerRow.name } }).returning();
      await db.update(s.listings).set({ buyBoxSellerId: seller!.id }).where(eq(s.listings.id, listing!.id));
      await db.update(s.priceObservations).set({ sellerId: seller!.id }).where(eq(s.priceObservations.listingId, listing!.id));

      const label = variantLabel(v.attributes, v.sizeText);
      const [variant] = await db
        .insert(s.variants)
        .values({ workspaceId: ws!.id, familyId: familyRow!.id, listingId: listing!.id, label, attributes: v.attributes, intervalMinutes: 60, priority: fam.brand === DEMO_REFERENCE_BRAND, createdAt: new Date(now - 120 * DAY) })
        .returning();
      for (const q of quantitiesFor({ variationAttributes: v.attributes, sizeText: v.sizeText, title: fam.title })) {
        await db.insert(s.variantQuantities).values({ variantId: variant!.id, dimension: q.dimension, packCount: q.packCount, unitAmount: String(q.unitAmount), unit: q.unit, totalMilli: q.totalMilli, countNoun: q.countNoun ?? null, sourceText: q.sourceText, matchedText: q.matchedText, confidence: "parsed" }).onConflictDoNothing();
      }
      variantByAsin.set(v.asin, { variantId: variant!.id, listingId: listing!.id, familyId: familyRow!.id, brand: fam.brand, label, title: fam.title, marketplace: fam.marketplace });
    }
  }

  // ── Comparison groups ──────────────────────────────────────────────────
  const fam = (key: string) => DEMO_FAMILIES.find((f) => f.key === key)!;
  const pick = (key: string, idx: number[]) => idx.map((i) => fam(key).variants[i]!.asin).filter((a) => variantByAsin.has(a));
  const groupDefs = [
    { name: "Plant Protein — India", description: "Vegan protein powders on Amazon India, normalized per 100 g.", basis: "per_100g", items: [...pick("lumen-plant-protein", [0, 1, 4]), ...pick("northfield-pea-protein", [0, 1, 2]), ...pick("pureform-organic-protein", [0, 1])], suggested: pick("kinetic-whey-isolate", [0]) },
    { name: "Women's Multivitamins", description: "Daily multivitamin tablets, compared per tablet.", basis: "per_unit", items: [...pick("lumen-womens-multi", [0, 1, 2]), ...pick("dailyroot-womens-multi", [0, 1])], suggested: [] },
    { name: "Vitamin C Supplements", description: "Tablets and capsules, per unit.", basis: "per_unit", items: [...pick("lumen-vitamin-c", [0]), ...pick("northfield-vitamin-c", [0, 1])], suggested: [] },
    { name: "Headphones price watch", description: "Over-ear ANC headphones (US). Compared per item.", basis: "per_pack", items: pick("arcwave-anc", [0, 1, 2]), suggested: [] },
  ];
  const groupIds: string[] = [];
  for (const g of groupDefs) {
    const [row] = await db.insert(s.comparisonGroups).values({ workspaceId: ws!.id, name: g.name, description: g.description, basis: g.basis, marketplace: variantByAsin.get(g.items[0]!)!.marketplace, referenceBrandId: brandIds.get(DEMO_REFERENCE_BRAND), createdBy: userId }).returning();
    groupIds.push(row!.id);
    await db.insert(s.comparisonItems).values([
      ...g.items.map((a, i) => ({ groupId: row!.id, variantId: variantByAsin.get(a)!.variantId, position: i, status: "confirmed" as const })),
      ...g.suggested.map((a, i) => ({ groupId: row!.id, variantId: variantByAsin.get(a)!.variantId, position: 100 + i, status: "suggested" as const, note: "Suggested: same category and pack size, different formulation (whey vs plant)" })),
    ]);
  }

  // ── Alert rules ────────────────────────────────────────────────────────
  const [dropRule] = await db.insert(s.alertRules).values({ workspaceId: ws!.id, createdBy: userId, name: "Competitor drops ≥ 5%", type: "pct_drop", groupId: groupIds[0], params: { pct: 5 }, cooldownMinutes: 120 }).returning();
  await db.insert(s.alertRules).values([
    { workspaceId: ws!.id, createdBy: userId, name: "Undercut in Plant Protein", type: "competitor_undercut", groupId: groupIds[0], params: {}, cooldownMinutes: 720 },
    { workspaceId: ws!.id, createdBy: userId, name: "Multivitamin stock-outs", type: "out_of_stock", groupId: groupIds[1], params: {}, cooldownMinutes: 360 },
    { workspaceId: ws!.id, createdBy: userId, name: "Stale data (6h)", type: "stale_data", params: { hours: 6 }, cooldownMinutes: 720, quietHours: { start: "22:00", end: "07:00" } },
  ]);

  // ── Activity & alert history from the simulated observations ───────────
  const recent = await db
    .select()
    .from(s.priceObservations)
    .where(and(inArray(s.priceObservations.listingId, [...variantByAsin.values()].map((v) => v.listingId)), gt(s.priceObservations.observedAt, new Date(now - 4 * DAY))))
    .orderBy(s.priceObservations.observedAt);
  const activity: (typeof s.activityLogs.$inferInsert)[] = [];
  for (const v of variantByAsin.values()) {
    const pts = recent.filter((r) => r.listingId === v.listingId).map((r) => ({ t: r.observedAt.getTime(), price: r.priceMinor, list: r.listPriceMinor, deal: r.dealPriceMinor }));
    const currency = recent.find((r) => r.listingId === v.listingId)?.currency ?? "INR";
    const name = `${v.title.split(",")[0]} · ${v.label}`;
    for (const e of detectEvents(pts)) {
      let message: string | null = null;
      let kind = e.kind as string;
      if (e.kind === "decrease" || e.kind === "increase" || e.kind === "baseline") {
        kind = e.ratio! < 0 ? "price_down" : "price_up";
        message = `${name} ${e.ratio! < 0 ? "dropped" : "rose"} ${formatPct(Math.abs(e.ratio!))} to ${formatMoney(e.to, currency)}`;
      } else if (e.kind === "out_of_stock") message = `${name} became unavailable`;
      else if (e.kind === "back_in_stock") message = `${name} is back in stock at ${formatMoney(e.to, currency)}`;
      if (!message) continue;
      activity.push({ workspaceId: ws!.id, kind, message, entityType: "family", entityId: v.familyId, metadata: { variantId: v.variantId, from: e.from, to: e.to, currency }, isSimulated: true, createdAt: new Date(e.t) });
      const inGroup = groupDefs[0]!.items.some((a) => variantByAsin.get(a)?.variantId === v.variantId);
      if (inGroup && e.ratio !== null && e.ratio <= -0.05 && v.brand !== DEMO_REFERENCE_BRAND) {
        const [ev] = await db
          .insert(s.alertEvents)
          .values({ ruleId: dropRule!.id, workspaceId: ws!.id, variantId: v.variantId, headline: `${name} fell ${formatPct(Math.abs(e.ratio))}`, detail: `${formatMoney(e.from, currency)} → ${formatMoney(e.to, currency)}`, metrics: { from: e.from, to: e.to, ratio: e.ratio }, dedupeKey: `pct_drop:${v.variantId}:${new Date(e.t).toISOString()}`, isSimulated: true, deliveredChannels: ["in_app"], firedAt: new Date(e.t + 60_000) })
          .onConflictDoNothing()
          .returning();
        if (ev) await db.insert(s.notifications).values({ workspaceId: ws!.id, kind: "alert", title: ev.headline, body: ev.detail, href: `/alerts?event=${ev.id}`, alertEventId: ev.id, isSimulated: true, createdAt: ev.firedAt, readAt: e.t < now - 2 * DAY ? new Date() : null });
      }
    }
  }
  const [lastFired] = await db.select({ t: sql<Date>`max(${s.alertEvents.firedAt})` }).from(s.alertEvents).where(eq(s.alertEvents.ruleId, dropRule!.id));
  if (lastFired?.t) await db.update(s.alertRules).set({ lastTriggeredAt: new Date(lastFired.t) }).where(eq(s.alertRules.id, dropRule!.id));
  activity.push({ workspaceId: ws!.id, actorUserId: userId, kind: "import", message: `Imported ${variantByAsin.size} variants across ${DEMO_FAMILIES.length} products (simulated catalog)`, isSimulated: true, createdAt: new Date(now - 120 * DAY) });
  for (let i = 0; i < activity.length; i += 500) await db.insert(s.activityLogs).values(activity.slice(i, i + 500));

  // ── Monitoring history (last 24h of hourly jobs) ───────────────────────
  const listingIds = [...variantByAsin.values()].map((v) => v.listingId);
  for (let hAgo = 24; hAgo >= 1; hAgo--) {
    const at = new Date(now - hAgo * HOUR);
    for (const mp of ["IN", "US", "GB"]) {
      const ids = [...variantByAsin.values()].filter((v) => v.marketplace === mp).map((v) => v.listingId);
      const failed = mp === "IN" && (hAgo === 50 || hAgo === 2);
      await db.insert(s.monitoringJobs).values({ kind: "scheduled", status: failed ? "partial" : "succeeded", provider: "demo", marketplace: mp, listingIds: ids, idempotencyKey: `seed:${mp}:${hAgo}:${ws!.id}`, attempts: 1, scheduledFor: at, startedAt: at, finishedAt: new Date(at.getTime() + 1800), observationsWritten: ids.length, tokensUsed: ids.length, error: failed ? "1 listing(s) not returned (simulated)" : null, createdAt: at });
      await db.insert(s.providerRequests).values({ provider: "demo", operation: "product", marketplace: mp, itemCount: ids.length, status: "ok", httpStatus: 200, durationMs: 140 + (hAgo % 7) * 23, tokensConsumed: ids.length, tokensLeft: 1100 - hAgo * 3, createdAt: at });
    }
  }
  await db
    .insert(s.providerQuotas)
    .values({ provider: "demo", tokensLeft: 1100, refillRate: 20, refillInMs: 60_000, monthKey: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`, tokensUsedMonth: listingIds.length * 24 * 11, requestsMonth: 24 * 11 * 3 })
    .onConflictDoNothing();
  // One paused variant to demonstrate the state.
  const paused = variantByAsin.get(fam("fernleaf-serum").variants[1]!.asin)!;
  await db.update(s.variants).set({ intervalMinutes: null }).where(eq(s.variants.id, paused.variantId));
  await db.update(s.listings).set({ checkIntervalMinutes: null, nextCheckAt: null }).where(inArray(s.listings.id, [paused.listingId]));

  // The demo's own brand comes from the fictional catalog (data, not code); build its "vs Market" comparisons.
  const managed = await reconcileReferenceMarket({ workspaceId: ws!.id, userId });
  // Last week's Monday Briefing, from the simulated observations above.
  await ensureBriefing(ws!.id, { actorUserId: userId });

  console.log(`✓ seeded demo workspace in ${Date.now() - started}ms — ${variantByAsin.size} variants (${variantByAsin.size - 1} monitored hourly, 1 paused on purpose to show the paused state), ${obsCount} simulated observations`);
  console.log(`  ${managed.cohorts.length} managed “${DEMO_REFERENCE_BRAND} vs Market” comparisons, ${managed.unmatched.length} listings not yet matched`);
  console.log(`  sign in: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .then(() => sqlClient.end())
  .catch(async (e) => {
    console.error("✗ seed failed:", e);
    await sqlClient.end().catch(() => {});
    process.exit(1);
  });
