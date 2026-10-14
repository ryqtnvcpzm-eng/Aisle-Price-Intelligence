import { MyBrandPanel } from "@/components/brand/my-brand-panel";
import { BrandsView } from "@/components/brands/brands-view";
import { Page } from "@/components/ui/page";
import { brandAnalytics } from "@/server/analytics/brands";
import { referenceOverview } from "@/server/brand/reference";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Brands" };

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireContext();
  const { brand } = await searchParams;
  const [stats, mine] = await Promise.all([brandAnalytics(ctx.workspace.id), referenceOverview(ctx.workspace.id)]);
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
      <div className="space-y-6">
        <MyBrandPanel data={{ brand: mine.brand, groups: mine.groups.map((g) => ({ id: g.id, name: g.name, basis: g.basis, marketplace: g.marketplace, items: g.items })), unmatched: mine.unmatched, protectionEnabled: Boolean(ctx.workspace.settings.brandProtection) }} />
        <BrandsView stats={data} initialBrand={brand ?? null} />
      </div>
    </Page>
  );
}
