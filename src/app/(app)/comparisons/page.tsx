import { ComparisonsIndex } from "@/components/comparisons/comparisons-index";
import { Page } from "@/components/ui/page";
import { listGroups } from "@/server/catalog/queries";
import { getGroupDetail } from "@/server/comparison/service";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Comparisons" };

export default async function ComparisonsPage() {
  const ctx = await requireContext();
  const groups = await listGroups(ctx.workspace.id);
  const details = await Promise.all(groups.map((g) => getGroupDetail(ctx.workspace.id, g.id)));
  const cards = details.map((d) => ({
    id: d.group.id,
    name: d.group.name,
    description: d.group.description,
    basis: d.result.basis,
    currency: d.result.currency,
    items: d.items.length,
    comparable: d.result.comparableCount,
    brands: [...new Set(d.items.map((i) => i.brandName ?? "Unbranded"))],
    images: d.items.slice(0, 5).map((i) => i.imageUrl),
    cheapest: d.result.cheapest ? { name: `${d.result.cheapest.brandName ?? ""} ${d.result.cheapest.label}`.trim(), unit: d.result.cheapest.unitPriceMinor, role: d.result.cheapest.role } : null,
    referencePremium: d.result.referenceBest?.premium ?? null,
    headline: d.result.findings[0]?.text ?? null,
    simulated: d.items.some((i) => i.isSimulated),
    bars: d.result.rows.filter((r) => r.comparable).sort((a, b) => a.unitPriceMinor! - b.unitPriceMinor!).map((r) => ({ id: r.id, unit: r.unitPriceMinor!, role: r.role })),
  }));
  return (
    <Page title="Comparisons" description="Named groups of comparable listings, ranked on a normalized unit-price basis.">
      <ComparisonsIndex cards={cards} />
    </Page>
  );
}
