import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db/client";
import { listings, priceObservations, sellers, variants } from "../db/schema";
import type { PriceSnapshot, ProviderId, ProviderProduct, SellerRef } from "../providers/types";

type Conn = Tx | typeof db;

export async function upsertSeller(conn: Conn, marketplace: string, seller: SellerRef | null): Promise<string | null> {
  if (!seller) return null;
  const [row] = await conn
    .insert(sellers)
    .values({ marketplace, sellerId: seller.id, name: seller.name, isAmazon: seller.isAmazon ?? false })
    .onConflictDoUpdate({
      target: [sellers.marketplace, sellers.sellerId],
      set: { name: sql`coalesce(excluded.name, ${sellers.name})`, isAmazon: sql`excluded.is_amazon or ${sellers.isAmazon}` },
    })
    .returning({ id: sellers.id });
  return row?.id ?? null;
}

/** Insert or refresh the shared listing row for marketplace + ASIN. Never blanks known fields with nulls. */
export async function upsertListing(conn: Conn, product: ProviderProduct, provider: ProviderId): Promise<string> {
  const [row] = await conn
    .insert(listings)
    .values({
      marketplace: product.marketplace,
      asin: product.asin,
      parentAsin: product.parentAsin,
      title: product.title,
      brandName: product.brand,
      imageUrl: product.imageUrl,
      categoryPath: product.categoryPath,
      variationAttributes: product.variationAttributes,
      sizeText: product.sizeText,
      provider,
      isSimulated: product.isSimulated,
      status: product.status,
      providerUpdatedAt: product.providerUpdatedAt,
      currency: product.snapshot?.currency ?? null,
    })
    .onConflictDoUpdate({
      target: [listings.marketplace, listings.asin],
      set: {
        parentAsin: sql`coalesce(excluded.parent_asin, ${listings.parentAsin})`,
        title: sql`coalesce(excluded.title, ${listings.title})`,
        brandName: sql`coalesce(excluded.brand_name, ${listings.brandName})`,
        imageUrl: sql`coalesce(excluded.image_url, ${listings.imageUrl})`,
        categoryPath: sql`coalesce(excluded.category_path, ${listings.categoryPath})`,
        variationAttributes: sql`coalesce(excluded.variation_attributes, ${listings.variationAttributes})`,
        sizeText: sql`coalesce(excluded.size_text, ${listings.sizeText})`,
        status: sql`excluded.status`,
        providerUpdatedAt: sql`coalesce(excluded.provider_updated_at, ${listings.providerUpdatedAt})`,
        currency: sql`coalesce(excluded.currency, ${listings.currency})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: listings.id });
  return row!.id;
}

export interface ObservationMeta {
  /** Data provider, or "capture" for prices the owner captured from a product page. */
  provider: ProviderId | "capture";
  source: "poll" | "import" | "backfill" | "manual" | "user-capture";
  requestedAt: Date | null;
  providerUpdatedAt: Date | null;
  isSimulated: boolean;
}

/**
 * Persist a snapshot and roll the listing's denormalized "latest" fields forward
 * (only if this observation is newer). Idempotent on (listing, observedAt, provider).
 * Returns whether the featured price changed vs. the previous observation.
 */
export async function writeObservation(conn: Conn, listingId: string, marketplace: string, snap: PriceSnapshot, meta: ObservationMeta) {
  const sellerId = await upsertSeller(conn, marketplace, snap.seller);
  const inserted = await conn
    .insert(priceObservations)
    .values({
      listingId,
      provider: meta.provider,
      source: meta.source,
      observedAt: snap.observedAt,
      requestedAt: meta.requestedAt,
      providerUpdatedAt: meta.providerUpdatedAt,
      currency: snap.currency,
      priceMinor: snap.priceMinor,
      priceBasis: snap.priceBasis,
      amazonPriceMinor: snap.amazonPriceMinor,
      lowestNewPriceMinor: snap.lowestNewPriceMinor,
      listPriceMinor: snap.listPriceMinor,
      dealPriceMinor: snap.dealPriceMinor,
      primeExclusivePriceMinor: snap.primeExclusivePriceMinor,
      shippingMinor: snap.shippingMinor,
      availability: snap.availability,
      sellerId,
      sellerIsAmazon: snap.seller?.isAmazon ?? null,
      isSimulated: meta.isSimulated,
    })
    .onConflictDoNothing()
    .returning({ id: priceObservations.id });

  const [prev] = await conn
    .select({ priceMinor: listings.currentPriceMinor, lastObservedAt: listings.lastObservedAt, availability: listings.availability, currentIsSimulated: listings.currentIsSimulated, isSimulated: listings.isSimulated })
    .from(listings)
    .where(eq(listings.id, listingId));
  // Source-aware: a simulated reading never replaces a verified current price (e.g. one the owner captured).
  const prevSimulated = prev ? (prev.currentIsSimulated ?? prev.isSimulated) : true;
  const outranked = meta.isSimulated && !prevSimulated;
  const isNewer = !outranked && (!prev?.lastObservedAt || prev.lastObservedAt.getTime() <= snap.observedAt.getTime());
  const changed = Boolean(prev && prev.lastObservedAt && prev.priceMinor !== snap.priceMinor);
  if (isNewer) {
    await conn
      .update(listings)
      .set({
        currentPriceMinor: snap.priceMinor,
        currentPriceBasis: snap.priceBasis,
        listPriceMinor: snap.listPriceMinor,
        availability: snap.availability,
        currency: snap.currency,
        buyBoxSellerId: sellerId,
        buyBoxIsAmazon: snap.seller?.isAmazon ?? null,
        lastObservedAt: snap.observedAt,
        currentSource: meta.source,
        currentIsSimulated: meta.isSimulated,
        ...(changed ? { lastPriceChangeAt: snap.observedAt } : {}),
      })
      .where(eq(listings.id, listingId));
  }
  return { inserted: inserted.length > 0, observationId: inserted[0]?.id ?? null, changed: isNewer && changed, previousPriceMinor: prev?.priceMinor ?? null, previousAvailability: prev?.availability ?? null };
}

/**
 * Recompute each listing's polling cadence from every workspace tracking it:
 * the shortest active interval wins (priority variants get a small boost);
 * if nobody tracks it any more, monitoring stops. This is what deduplicates
 * provider spend across workspaces and comparison groups.
 */
export async function rescheduleListings(conn: Conn, listingIds: string[]) {
  if (!listingIds.length) return;
  const rows = await conn
    .select({
      listingId: variants.listingId,
      interval: sql<number | null>`min(${variants.intervalMinutes})`,
      priority: sql<number>`max(case when ${variants.priority} then 1 else 0 end)`,
    })
    .from(variants)
    .where(and(inArray(variants.listingId, listingIds), eq(variants.tracked, true), isNotNull(variants.intervalMinutes)))
    .groupBy(variants.listingId);
  const byId = new Map(rows.map((r) => [r.listingId, r]));
  for (const id of listingIds) {
    const r = byId.get(id);
    if (!r?.interval) {
      await conn.update(listings).set({ checkIntervalMinutes: null, nextCheckAt: null }).where(eq(listings.id, id));
      continue;
    }
    await conn
      .update(listings)
      .set({
        checkIntervalMinutes: r.interval,
        priority: r.priority,
        // Keep an earlier scheduled time; otherwise schedule one interval from the last success.
        nextCheckAt: sql`least(coalesce(${listings.nextCheckAt}, now() + make_interval(mins => ${r.interval})), coalesce(${listings.lastSuccessAt}, now()) + make_interval(mins => ${r.interval}))`,
      })
      .where(eq(listings.id, id));
  }
}
