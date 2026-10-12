import { InsightsView } from "@/components/insights/insights-view";
import { Page } from "@/components/ui/page";
import { computeInsights } from "@/server/insights/engine";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const ctx = await requireContext();
  const insights = await computeInsights(ctx.workspace.id, { significantPct: ctx.workspace.settings.significantChangePct });
  return (
    <Page title="Insights" description="Findings a pricing analyst would flag, computed deterministically from your stored observations. Each one shows its evidence.">
      <InsightsView insights={insights} />
    </Page>
  );
}
