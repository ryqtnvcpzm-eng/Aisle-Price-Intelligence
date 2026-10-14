import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProductDetail, type LatestObservation } from "@/components/products/product-detail";
import { getFamily, listVariantRows } from "@/server/catalog/queries";
import { db } from "@/server/db/client";
import { listRules } from "@/server/alerts/service";
import { requireContext } from "@/server/workspace/context";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  if (!z.string().uuid().safeParse(id).success) return { title: "Product" };
  const f = await getFamily(ctx.workspace.id, id);
  return { title: f?.family.title.split(",")[0] ?? "Product" };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ variant?: string }> }) {
  const { id } = await params;
  const { variant } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireContext();
  const family = await getFamily(ctx.workspace.id, id);
  if (!family) notFound();
  const rows = await listVariantRows(ctx.workspace.id, { familyId: id, includeArchived: true });
  const listingIds = rows.map((r) => r.listingId);
  const latest = listingIds.length
    ? await db.execute<Record<string, unknown>>(sql`
        select distinct on (o.listing_id) o.listing_id, o.observed_at, o.captured_at, o.requested_at, o.provider_updated_at, o.provider, o.currency,
          o.price_minor, o.price_basis, o.amazon_price_minor, o.lowest_new_price_minor, o.list_price_minor, o.deal_price_minor,
          o.prime_exclusive_price_minor, o.shipping_minor, o.availability, o.seller_is_amazon, s.name seller_name, o.is_simulated, o.source
        from price_observations o
        join listings l on l.id = o.listing_id
        left join sellers s on s.id = o.seller_id
        -- The observation behind the current price: a later simulated reading never displaces a captured one.
        where o.listing_id in ${listingIds} and o.is_simulated = coalesce(l.current_is_simulated, l.is_simulated)
        order by o.listing_id, o.observed_at desc`)
    : [];
  const rules = (await listRules(ctx.workspace.id)).filter((r) => rows.some((v) => v.variantId === r.variant_id) || rows.some((v) => v.groups.some((g) => g.id === r.group_id)));
  const obs: Record<string, LatestObservation> = {};
  for (const o of latest) {
    obs[o.listing_id as string] = {
      observedAt: new Date(o.observed_at as string).toISOString(),
      capturedAt: new Date(o.captured_at as string).toISOString(),
      requestedAt: o.requested_at ? new Date(o.requested_at as string).toISOString() : null,
      providerUpdatedAt: o.provider_updated_at ? new Date(o.provider_updated_at as string).toISOString() : null,
      provider: o.provider as string,
      currency: o.currency as string,
      priceMinor: o.price_minor as number | null,
      priceBasis: o.price_basis as string,
      amazonPriceMinor: o.amazon_price_minor as number | null,
      lowestNewPriceMinor: o.lowest_new_price_minor as number | null,
      listPriceMinor: o.list_price_minor as number | null,
      dealPriceMinor: o.deal_price_minor as number | null,
      primeExclusivePriceMinor: o.prime_exclusive_price_minor as number | null,
      shippingMinor: o.shipping_minor as number | null,
      availability: o.availability as string,
      sellerIsAmazon: o.seller_is_amazon as boolean | null,
      sellerName: o.seller_name as string | null,
      isSimulated: o.is_simulated as boolean,
      source: o.source as string,
    };
  }
  return (
    <ProductDetail
      family={{ ...JSON.parse(JSON.stringify(family.family)), brandName: family.brandName, isReference: family.isReference ?? false, categoryName: family.categoryName }}
      variants={rows}
      observations={obs}
      rules={JSON.parse(JSON.stringify(rules))}
      focusVariant={variant ?? null}
    />
  );
}
