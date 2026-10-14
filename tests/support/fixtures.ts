/** Shared helpers for integration tests: isolated workspaces and deterministic observations. */
import { randomUUID } from "node:crypto";
import { and, inArray, sql } from "drizzle-orm";
import { commitImport, previewImport } from "@/server/catalog/import";
import { writeObservation } from "@/server/catalog/persist";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { AppContext } from "@/server/workspace/context";

export async function makeContext(name: string, opts: { timeZone?: string } = {}): Promise<AppContext> {
  const userId = randomUUID();
  await db.insert(s.user).values({ id: userId, name, email: `${userId}@test.local` });
  const [ws] = await db.insert(s.workspaces).values({ name: `${name} WS`, slug: `t-${userId.slice(0, 8)}`, onboardedAt: new Date(), ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }).returning();
  await db.insert(s.workspaceMembers).values({ workspaceId: ws!.id, userId, role: "owner" });
  return { user: { id: userId, name, email: `${userId}@test.local` }, workspace: ws!, role: "owner" };
}

/** Import every variant of the listing's family (demo provider). */
export async function importFamily(ctx: AppContext, input: string, opts: { asins?: string[]; groupId?: string } = {}) {
  const p = await previewImport(ctx, input, null);
  if (!p.families.length) throw new Error(`nothing to import for ${input}: ${JSON.stringify(p.errors)}`);
  const fam = p.families[0]!;
  return commitImport(ctx, { previewId: p.previewId, families: [{ key: fam.key, asins: opts.asins ?? fam.variants.filter((v) => v.status !== "no_data").map((v) => v.asin) }], groupId: opts.groupId, intervalMinutes: 60 });
}

const touched = new Set<string>();

export async function observe(listingId: string, o: { priceMinor: number | null; availability?: "in_stock" | "out_of_stock" | "unknown" | "limited"; at?: Date; isSimulated?: boolean; currency?: string }) {
  touched.add(listingId);
  return writeObservation(
    db,
    listingId,
    "IN",
    {
      observedAt: o.at ?? new Date(),
      currency: o.currency ?? "INR",
      priceMinor: o.priceMinor,
      priceBasis: o.priceMinor === null ? "none" : "buy_box",
      amazonPriceMinor: null,
      lowestNewPriceMinor: null,
      listPriceMinor: null,
      dealPriceMinor: null,
      primeExclusivePriceMinor: null,
      shippingMinor: 0,
      availability: o.availability ?? "in_stock",
      seller: null,
    },
    { provider: "demo", source: "manual", requestedAt: new Date(), providerUpdatedAt: new Date(), isSimulated: o.isSimulated ?? true },
  );
}

/**
 * Listings are a shared catalog, so observations a test invents would leak into
 * other test files. Remove them and roll each listing back to its newest real observation.
 */
/** Mark a listing as touched by a test that writes observations through other paths (e.g. captures). */
export function touchListing(id: string) {
  touched.add(id);
}

export async function restoreObservedListings() {
  const ids = [...touched];
  touched.clear();
  if (!ids.length) return;
  await db.delete(s.priceObservations).where(and(inArray(s.priceObservations.listingId, ids), inArray(s.priceObservations.source, ["manual", "user-capture"])));
  await db.execute(sql`
    update listings l set current_price_minor = o.price_minor, current_price_basis = o.price_basis, availability = o.availability, currency = o.currency, last_observed_at = o.observed_at, current_source = o.source, current_is_simulated = o.is_simulated
    from (select distinct on (listing_id) * from price_observations where listing_id in ${ids} order by listing_id, observed_at desc) o
    where o.listing_id = l.id`);
}
