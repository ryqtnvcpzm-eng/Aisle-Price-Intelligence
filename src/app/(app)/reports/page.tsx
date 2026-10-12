import { desc, eq } from "drizzle-orm";
import { Suspense } from "react";
import { ReportsView } from "@/components/reports/reports-view";
import { Page } from "@/components/ui/page";
import { groupByFamily, listGroups, listVariantRows } from "@/server/catalog/queries";
import { db } from "@/server/db/client";
import { reportDefinitions, reportRuns } from "@/server/db/schema";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireContext();
  const [rows, groups, defs, runs] = await Promise.all([
    listVariantRows(ctx.workspace.id),
    listGroups(ctx.workspace.id),
    db.select().from(reportDefinitions).where(eq(reportDefinitions.workspaceId, ctx.workspace.id)).orderBy(desc(reportDefinitions.createdAt)),
    db.select().from(reportRuns).where(eq(reportRuns.workspaceId, ctx.workspace.id)).orderBy(desc(reportRuns.createdAt)).limit(15),
  ]);
  const families = groupByFamily(rows);
  return (
    <Page title="Reports" description="Reproducible exports with methodology and data-freshness notes. Missing history is never filled in.">
      <Suspense>
        <ReportsView
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
          families={families.map((f) => ({ id: f.familyId, name: `${f.brandName ?? ""} · ${f.title.replace(f.brandName ?? "", "").split(",")[0]!.trim()}` }))}
          brands={[...new Set(rows.map((r) => r.brandName ?? "Unbranded"))]}
          marketplaces={[...new Set(rows.map((r) => r.marketplace))]}
          definitions={JSON.parse(JSON.stringify(defs))}
          runs={JSON.parse(JSON.stringify(runs))}
        />
      </Suspense>
    </Page>
  );
}
