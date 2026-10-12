import { Suspense } from "react";
import { AlertsView } from "@/components/alerts/alerts-view";
import { Page } from "@/components/ui/page";
import { listEvents, listRules } from "@/server/alerts/service";
import { listGroups, listVariantRows } from "@/server/catalog/queries";
import { env } from "@/server/env";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const ctx = await requireContext();
  const [rules, events, rows, groups] = await Promise.all([listRules(ctx.workspace.id), listEvents(ctx.workspace.id, 150), listVariantRows(ctx.workspace.id), listGroups(ctx.workspace.id)]);
  return (
    <Page title="Alerts" description="Rules that watch prices, competitors, availability and data health — with cooldowns and quiet hours so they stay useful.">
      <Suspense>
        <AlertsView
          rules={JSON.parse(JSON.stringify(rules))}
          events={JSON.parse(JSON.stringify(events))}
          variants={rows.filter((r) => r.tracked).map((r) => ({ id: r.variantId, name: `${r.brandName ?? ""} · ${r.familyTitle.replace(r.brandName ?? "", "").split(/[,(]/)[0]!.trim()} · ${r.label}`, currency: r.currency ?? "INR", price: r.priceMinor }))}
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          emailConfigured={Boolean(env.RESEND_API_KEY)}
        />
      </Suspense>
    </Page>
  );
}
