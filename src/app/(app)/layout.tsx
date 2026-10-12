import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import type { AppInfo } from "@/components/shell/app-context";
import { db } from "@/server/db/client";
import { DEMO_SAMPLE_LINKS } from "@/server/providers/demo/catalog";
import { dataMode, getActiveProvider } from "@/server/providers";
import { requireContext } from "@/server/workspace/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (!ctx.workspace.onboardedAt) redirect("/welcome");
  const jar = await cookies();
  const mpRows = await db.execute<{ marketplace: string }>(sql`select distinct marketplace from product_families where workspace_id = ${ctx.workspace.id} and archived_at is null order by 1`);
  const mode = dataMode();
  const info: AppInfo = {
    user: ctx.user,
    workspace: {
      id: ctx.workspace.id,
      name: ctx.workspace.name,
      defaultMarketplace: ctx.workspace.defaultMarketplace,
      defaultBasis: ctx.workspace.defaultBasis,
      timeZone: ctx.workspace.timeZone,
      onboarded: true,
      settings: ctx.workspace.settings,
    },
    role: ctx.role,
    dataMode: mode,
    providerLabel: getActiveProvider().label,
    sampleLinks: mode === "demo" ? DEMO_SAMPLE_LINKS : [],
    marketplaces: [...new Set([ctx.workspace.defaultMarketplace, ...mpRows.map((r) => r.marketplace)])],
  };
  const mp = jar.get("aisle_mp")?.value;
  return (
    <AppShell info={info} initialSidebarCollapsed={jar.get("aisle_sidebar")?.value === "collapsed"} initialMarketplace={mp && mp !== "all" ? mp : null}>
      {children}
    </AppShell>
  );
}
