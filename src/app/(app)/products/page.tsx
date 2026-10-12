import { and, desc, eq } from "drizzle-orm";
import { Suspense } from "react";
import { Library } from "@/components/products/library";
import { Page } from "@/components/ui/page";
import { groupByFamily, listVariantRows } from "@/server/catalog/queries";
import { db } from "@/server/db/client";
import { savedViews } from "@/server/db/schema";
import { requireContext } from "@/server/workspace/context";

export const metadata = { title: "Products" };

export default async function ProductsPage() {
  const ctx = await requireContext();
  const [rows, views] = await Promise.all([
    listVariantRows(ctx.workspace.id),
    db.select().from(savedViews).where(and(eq(savedViews.workspaceId, ctx.workspace.id), eq(savedViews.scope, "products"))).orderBy(desc(savedViews.createdAt)),
  ]);
  const families = groupByFamily(rows);
  return (
    <Page title="Products" description="Every product family you track, with each variant monitored independently." wide>
      <Suspense>
        <Library families={families} savedViews={views.map((v) => ({ id: v.id, name: v.name, state: v.state }))} />
      </Suspense>
    </Page>
  );
}
