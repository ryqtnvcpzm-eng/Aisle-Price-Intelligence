import "server-only";
import { and, asc, gte, inArray, sql } from "drizzle-orm";
import type { Obs } from "@/lib/analytics";
import { db } from "../db/client";
import { priceObservations } from "../db/schema";

/** Load observation series for many listings in one query, oldest first. */
export async function loadSeries(listingIds: string[], since: Date, opts: { carryIn?: boolean } = {}): Promise<Map<string, Obs[]>> {
  const out = new Map<string, Obs[]>();
  if (!listingIds.length) return out;
  for (const id of listingIds) out.set(id, []);
  const rows = await db
    .select({
      listingId: priceObservations.listingId,
      t: priceObservations.observedAt,
      price: priceObservations.priceMinor,
      list: priceObservations.listPriceMinor,
      deal: priceObservations.dealPriceMinor,
      availability: priceObservations.availability,
      sellerId: priceObservations.sellerId,
    })
    .from(priceObservations)
    .where(and(inArray(priceObservations.listingId, listingIds), gte(priceObservations.observedAt, since)))
    .orderBy(asc(priceObservations.observedAt));
  // One observation before the window so step series start with a known value.
  if (opts.carryIn !== false) {
    const carry = await db.execute<{ listing_id: string; observed_at: Date; price_minor: number | null; list_price_minor: number | null; deal_price_minor: number | null; availability: string; seller_id: string | null }>(sql`
      select distinct on (listing_id) listing_id, observed_at, price_minor, list_price_minor, deal_price_minor, availability, seller_id
      from price_observations
      where listing_id in ${listingIds} and observed_at < ${since.toISOString()}
      order by listing_id, observed_at desc`);
    for (const c of carry) {
      out.get(c.listing_id)?.push({ t: new Date(c.observed_at).getTime(), price: c.price_minor, list: c.list_price_minor, deal: c.deal_price_minor, inStock: c.availability !== "out_of_stock", sellerId: c.seller_id });
    }
  }
  for (const r of rows) {
    out.get(r.listingId)!.push({ t: r.t.getTime(), price: r.price, list: r.list, deal: r.deal, inStock: r.availability !== "out_of_stock", sellerId: r.sellerId });
  }
  return out;
}
