import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { freshnessOf, type FreshnessState } from "@/lib/freshness";
import { defaultBasisFor, type Dimension, type QuantityConfidence } from "@/lib/quantity";
import { db } from "../db/client";
import { brands, categories, comparisonGroups, comparisonItems, productFamilies, variantQuantities } from "../db/schema";

export interface QuantityRow {
  dimension: Dimension;
  packCount: number;
  unitAmount: number;
  unit: string;
  totalMilli: number;
  countNoun: string | null;
  sourceText: string | null;
  matchedText: string | null;
  confidence: QuantityConfidence;
}

export interface VariantRow {
  variantId: string;
  label: string;
  attributes: Record<string, string>;
  tracked: boolean;
  hidden: boolean;
  tags: string[];
  intervalMinutes: number | null;
  priority: boolean;
  familyId: string;
  familyTitle: string;
  imageUrl: string | null;
  favorite: boolean;
  familyTags: string[];
  discoveryStatus: string;
  marketplace: string;
  isSimulated: boolean;
  brandId: string | null;
  brandName: string | null;
  isReferenceBrand: boolean;
  categoryName: string | null;
  listingId: string;
  asin: string;
  provider: string;
  priceMinor: number | null;
  priceBasis: string | null;
  listPriceMinor: number | null;
  currency: string | null;
  availability: string;
  status: string;
  sellerName: string | null;
  buyBoxIsAmazon: boolean | null;
  lastObservedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  providerUpdatedAt: string | null;
  nextCheckAt: string | null;
  checkIntervalMinutes: number | null;
  consecutiveFailures: number;
  lastPriceChangeAt: string | null;
  p24: number | null;
  p7: number | null;
  p30: number | null;
  p90: number | null;
  lowest: number | null;
  highest: number | null;
  observationCount: number;
  quantities: QuantityRow[];
  freshness: FreshnessState;
  groups: { id: string; name: string }[];
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/**
 * Every tracked variant in a workspace with its latest price, honest period
 * changes and history extremes. Each "price N ago" uses the last observation
 * inside a bounded window before the mark, so a stale reading never poses as
 * a 24-hour comparison. Index-backed via obs_listing_time_idx.
 */
export async function listVariantRows(workspaceId: string, opts: { familyId?: string; variantIds?: string[]; includeArchived?: boolean } = {}): Promise<VariantRow[]> {
  const famFilter = opts.familyId ? sql`and f.id = ${opts.familyId}` : sql``;
  const varFilter = opts.variantIds?.length ? sql`and v.id in ${opts.variantIds}` : opts.variantIds ? sql`and false` : sql``;
  const archFilter = opts.includeArchived ? sql`` : sql`and f.archived_at is null`;
  const rows = await db.execute<Record<string, unknown>>(sql`
    select v.id variant_id, v.label, v.attributes, v.tracked, v.hidden, v.tags, v.interval_minutes, v.priority,
      f.id family_id, f.title family_title, coalesce(l.image_url, f.image_url) image_url, f.favorite, f.tags family_tags, f.discovery_status, f.marketplace, l.is_simulated,
      b.id brand_id, b.name brand_name, coalesce(b.is_reference, false) is_reference, c.name category_name,
      l.id listing_id, l.asin, l.provider, l.current_price_minor, l.current_price_basis, l.list_price_minor, l.currency, l.availability, l.status,
      s.name seller_name, l.buy_box_is_amazon, l.last_observed_at, l.last_success_at, l.last_failure_at, l.last_error, l.provider_updated_at,
      l.next_check_at, l.check_interval_minutes, l.consecutive_failures, l.last_price_change_at,
      p24.price_minor p24, p7.price_minor p7, p30.price_minor p30, p90.price_minor p90, ext.lo, ext.hi, ext.n
    from variants v
      join listings l on l.id = v.listing_id
      join product_families f on f.id = v.family_id
      left join brands b on b.id = f.brand_id
      left join categories c on c.id = f.category_id
      left join sellers s on s.id = l.buy_box_seller_id
      left join lateral (select price_minor from price_observations o where o.listing_id = l.id and o.observed_at <= now() - interval '24 hours' and o.observed_at > now() - interval '48 hours' order by o.observed_at desc limit 1) p24 on true
      left join lateral (select price_minor from price_observations o where o.listing_id = l.id and o.observed_at <= now() - interval '7 days' and o.observed_at > now() - interval '10 days' order by o.observed_at desc limit 1) p7 on true
      left join lateral (select price_minor from price_observations o where o.listing_id = l.id and o.observed_at <= now() - interval '30 days' and o.observed_at > now() - interval '37 days' order by o.observed_at desc limit 1) p30 on true
      left join lateral (select price_minor from price_observations o where o.listing_id = l.id and o.observed_at <= now() - interval '90 days' and o.observed_at > now() - interval '100 days' order by o.observed_at desc limit 1) p90 on true
      left join lateral (select min(price_minor) lo, max(price_minor) hi, count(*)::int n from price_observations o where o.listing_id = l.id) ext on true
    where v.workspace_id = ${workspaceId} ${archFilter} ${famFilter} ${varFilter}
    order by coalesce(b.is_reference, false) desc, b.name nulls last, f.title, v.label`);

  const variantIds = rows.map((r) => r.variant_id as string);
  const qs = variantIds.length ? await db.select().from(variantQuantities).where(inArray(variantQuantities.variantId, variantIds)) : [];
  const groups = variantIds.length
    ? await db
        .select({ variantId: comparisonItems.variantId, id: comparisonGroups.id, name: comparisonGroups.name })
        .from(comparisonItems)
        .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonItems.groupId))
        .where(and(inArray(comparisonItems.variantId, variantIds), sql`${comparisonGroups.archivedAt} is null`))
    : [];

  return rows.map((r) => {
    const variantId = r.variant_id as string;
    const freshness = freshnessOf({
      intervalMinutes: (r.check_interval_minutes as number | null) ?? null,
      lastSuccessAt: r.last_success_at as Date | null,
      lastFailureAt: r.last_failure_at as Date | null,
      providerUpdatedAt: r.provider_updated_at as Date | null,
      nextCheckAt: r.next_check_at as Date | null,
      lastObservedAt: r.last_observed_at as Date | null,
      consecutiveFailures: r.consecutive_failures as number,
      status: r.status as string,
    });
    return {
      variantId,
      label: r.label as string,
      attributes: (r.attributes as Record<string, string>) ?? {},
      tracked: r.tracked as boolean,
      hidden: r.hidden as boolean,
      tags: (r.tags as string[]) ?? [],
      intervalMinutes: (r.interval_minutes as number | null) ?? null,
      priority: r.priority as boolean,
      familyId: r.family_id as string,
      familyTitle: r.family_title as string,
      imageUrl: (r.image_url as string | null) ?? null,
      favorite: r.favorite as boolean,
      familyTags: (r.family_tags as string[]) ?? [],
      discoveryStatus: r.discovery_status as string,
      marketplace: r.marketplace as string,
      isSimulated: r.is_simulated as boolean,
      brandId: (r.brand_id as string | null) ?? null,
      brandName: (r.brand_name as string | null) ?? null,
      isReferenceBrand: r.is_reference as boolean,
      categoryName: (r.category_name as string | null) ?? null,
      listingId: r.listing_id as string,
      asin: r.asin as string,
      provider: r.provider as string,
      priceMinor: (r.current_price_minor as number | null) ?? null,
      priceBasis: (r.current_price_basis as string | null) ?? null,
      listPriceMinor: (r.list_price_minor as number | null) ?? null,
      currency: (r.currency as string | null) ?? null,
      availability: r.availability as string,
      status: r.status as string,
      sellerName: (r.seller_name as string | null) ?? null,
      buyBoxIsAmazon: (r.buy_box_is_amazon as boolean | null) ?? null,
      lastObservedAt: iso(r.last_observed_at),
      lastSuccessAt: iso(r.last_success_at),
      lastFailureAt: iso(r.last_failure_at),
      lastError: (r.last_error as string | null) ?? null,
      providerUpdatedAt: iso(r.provider_updated_at),
      nextCheckAt: iso(r.next_check_at),
      checkIntervalMinutes: (r.check_interval_minutes as number | null) ?? null,
      consecutiveFailures: r.consecutive_failures as number,
      lastPriceChangeAt: iso(r.last_price_change_at),
      p24: (r.p24 as number | null) ?? null,
      p7: (r.p7 as number | null) ?? null,
      p30: (r.p30 as number | null) ?? null,
      p90: (r.p90 as number | null) ?? null,
      lowest: (r.lo as number | null) ?? null,
      highest: (r.hi as number | null) ?? null,
      observationCount: (r.n as number) ?? 0,
      quantities: qs
        .filter((q) => q.variantId === variantId)
        .map((q) => ({ dimension: q.dimension, packCount: q.packCount, unitAmount: Number(q.unitAmount), unit: q.unit, totalMilli: q.totalMilli, countNoun: q.countNoun, sourceText: q.sourceText, matchedText: q.matchedText, confidence: q.confidence })),
      freshness,
      groups: groups.filter((g) => g.variantId === variantId).map((g) => ({ id: g.id, name: g.name })),
    };
  });
}

export interface FamilySummary {
  familyId: string;
  title: string;
  imageUrl: string | null;
  brandName: string | null;
  brandId: string | null;
  isReferenceBrand: boolean;
  categoryName: string | null;
  marketplace: string;
  favorite: boolean;
  tags: string[];
  isSimulated: boolean;
  discoveryStatus: string;
  variants: VariantRow[];
}

export function groupByFamily(rows: VariantRow[]): FamilySummary[] {
  const map = new Map<string, FamilySummary>();
  for (const r of rows) {
    let f = map.get(r.familyId);
    if (!f) {
      f = { familyId: r.familyId, title: r.familyTitle, imageUrl: r.imageUrl, brandName: r.brandName, brandId: r.brandId, isReferenceBrand: r.isReferenceBrand, categoryName: r.categoryName, marketplace: r.marketplace, favorite: r.favorite, tags: r.familyTags, isSimulated: r.isSimulated, discoveryStatus: r.discoveryStatus, variants: [] };
      map.set(r.familyId, f);
    }
    f.variants.push(r);
  }
  return [...map.values()];
}

export async function getFamily(workspaceId: string, familyId: string) {
  const [f] = await db
    .select({ family: productFamilies, brandName: brands.name, isReference: brands.isReference, categoryName: categories.name })
    .from(productFamilies)
    .leftJoin(brands, eq(brands.id, productFamilies.brandId))
    .leftJoin(categories, eq(categories.id, productFamilies.categoryId))
    .where(and(eq(productFamilies.id, familyId), eq(productFamilies.workspaceId, workspaceId)));
  return f ?? null;
}

export async function listBrands(workspaceId: string) {
  return db.select().from(brands).where(eq(brands.workspaceId, workspaceId)).orderBy(desc(brands.isReference), asc(brands.name));
}

export async function listCategories(workspaceId: string) {
  return db.select().from(categories).where(eq(categories.workspaceId, workspaceId)).orderBy(asc(categories.name));
}

export async function listGroups(workspaceId: string) {
  const rows = await db.execute<{ id: string; name: string; description: string | null; basis: string; marketplace: string | null; reference_brand_id: string | null; item_count: number; brand_count: number; updated_at: Date }>(sql`
    select g.id, g.name, g.description, g.basis, g.marketplace, g.reference_brand_id, g.updated_at,
      count(ci.id)::int item_count, count(distinct f.brand_id)::int brand_count
    from comparison_groups g
      left join comparison_items ci on ci.group_id = g.id
      left join variants v on v.id = ci.variant_id
      left join product_families f on f.id = v.family_id
    where g.workspace_id = ${workspaceId} and g.archived_at is null
    group by g.id order by g.updated_at desc`);
  return rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}

export function basisForVariant(v: Pick<VariantRow, "quantities">) {
  const order: Dimension[] = ["mass", "volume", "count", "serving"];
  for (const d of order) if (v.quantities.some((q) => q.dimension === d)) return defaultBasisFor(d);
  return null;
}
