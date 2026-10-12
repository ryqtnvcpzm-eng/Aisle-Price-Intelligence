import { cookies } from "next/headers";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getDashboard } from "@/server/analytics/dashboard";
import { computeInsights } from "@/server/insights/engine";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireContext();
  const mp = (await cookies()).get("aisle_mp")?.value;
  const marketplace = mp && mp !== "all" ? mp : null;
  const [data, insights] = await Promise.all([getDashboard(ctx.workspace.id, marketplace), computeInsights(ctx.workspace.id, { significantPct: ctx.workspace.settings.significantChangePct })]);
  const scoped = marketplace ? insights.filter((i) => data.rows.some((r) => i.items.some((it) => it.variantId === r.variantId)) || !i.items.length) : insights;
  const { rows: _rows, ...rest } = data;
  return <Dashboard data={JSON.parse(JSON.stringify(rest))} insights={scoped.slice(0, 5)} userName={ctx.user.name} renderedAt={new Date().toISOString()} />;
}
