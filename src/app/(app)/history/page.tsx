import { HistoryExplorer } from "@/components/history/history-explorer";
import { Page } from "@/components/ui/page";
import { listGroups, listVariantRows } from "@/server/catalog/queries";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Price History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ variants?: string; group?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const rows = (await listVariantRows(ctx.workspace.id)).filter((r) => r.tracked);
  const groups = await listGroups(ctx.workspace.id);
  return (
    <Page title="Price History" description="Overlay any tracked listings. Readings hold until the next observation; gaps mean no trustworthy data, never a guess." wide>
      <HistoryExplorer
        options={rows.map((r) => ({ variantId: r.variantId, name: `${r.brandName ?? "Unbranded"} · ${r.familyTitle.replace(r.brandName ?? "", "").split(/[,(]/)[0]!.trim()} · ${r.label}`, brandName: r.brandName, isReference: r.isReferenceBrand, marketplace: r.marketplace, currency: r.currency }))}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        initial={sp.variants?.split(",").filter(Boolean)}
      />
    </Page>
  );
}
