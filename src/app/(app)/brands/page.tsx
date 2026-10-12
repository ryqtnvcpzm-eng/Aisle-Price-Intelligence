import { BrandsView } from "@/components/brands/brands-view";
import { Page } from "@/components/ui/page";
import { brandAnalytics } from "@/server/analytics/brands";
import { listBrands } from "@/server/catalog/queries";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Brands" };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireContext();
  const { brand } = await searchParams;
  const [stats, brands] = await Promise.all([brandAnalytics(ctx.workspace.id), listBrands(ctx.workspace.id)]);
  const data = stats.map(({ rows, ...s }) => ({
    ...s,
    products: [...new Map(rows.map((r) => [r.familyId, { id: r.familyId, title: r.familyTitle, imageUrl: r.imageUrl, variants: rows.filter((x) => x.familyId === r.familyId).length, marketplace: r.marketplace }])).values()],
    changes: rows
      .filter((r) => r.priceMinor !== null && r.p7 !== null && r.p7 !== r.priceMinor)
      .map((r) => ({ variantId: r.variantId, familyId: r.familyId, label: r.label, title: r.familyTitle, from: r.p7!, to: r.priceMinor!, currency: r.currency ?? "INR" }))
      .slice(0, 8),
  }));
  return (
    <Page title="Brands" description="How each brand you monitor is priced against the others — across the listings you track, not the whole market.">
      <BrandsView stats={data} brands={brands.map((b) => ({ id: b.id, name: b.name, isReference: b.isReference }))} initialBrand={brand ?? null} />
    </Page>
  );
}
