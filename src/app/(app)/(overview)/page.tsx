import { cookies } from "next/headers";
import { Dashboard, type OverviewExtras } from "@/components/dashboard/dashboard";
import { protectionStatus } from "@/server/alerts/protection";
import { getBriefing } from "@/server/briefing/service";
import { getDashboard } from "@/server/analytics/dashboard";
import { computeInsights } from "@/server/insights/engine";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireContext();
  const mp = (await cookies()).get("aisle_mp")?.value;
  const marketplace = mp && mp !== "all" ? mp : null;
  const [data, insights, briefing, protection] = await Promise.all([getDashboard(ctx.workspace.id, marketplace), computeInsights(ctx.workspace.id, { significantPct: ctx.workspace.settings.significantChangePct }), getBriefing(ctx.workspace.id), protectionStatus(ctx.workspace.id)]);
  const extras: OverviewExtras = {
    briefing: briefing ? { weekStart: briefing.weekStart, weekEnd: briefing.weekEnd, sentences: briefing.content.summary.sentences, containsSimulated: briefing.containsSimulated } : null,
    brand: protection.brand,
    protection: { enabled: protection.enabled, comparisons: protection.groups.length, alerts7d: protection.fired7d },
  };
  const scoped = marketplace ? insights.filter((i) => data.rows.some((r) => i.items.some((it) => it.variantId === r.variantId)) || !i.items.length) : insights;
  const { rows: _rows, ...rest } = data;
  return <Dashboard data={JSON.parse(JSON.stringify(rest))} insights={scoped.slice(0, 5)} userName={ctx.user.name} renderedAt={new Date().toISOString()} extras={extras} />;
}
