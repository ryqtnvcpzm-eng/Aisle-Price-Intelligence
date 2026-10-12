import { z } from "zod";
import { listGroups, listVariantRows } from "@/server/catalog/queries";
import { handle } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

/** Command-palette search across products, variants, brands and comparisons in this workspace. */
export const GET = handle(async (req) => {
  const ctx = await requireApiContext();
  const q = z.string().max(100).parse(req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const rows = await listVariantRows(ctx.workspace.id);
  const groups = await listGroups(ctx.workspace.id);
  const families = new Map<string, { id: string; title: string; brand: string | null; imageUrl: string | null; marketplace: string; variants: number; asins: string[] }>();
  for (const r of rows) {
    const f = families.get(r.familyId) ?? { id: r.familyId, title: r.familyTitle, brand: r.brandName, imageUrl: r.imageUrl, marketplace: r.marketplace, variants: 0, asins: [] };
    f.variants++;
    f.asins.push(r.asin);
    families.set(r.familyId, f);
  }
  const match = (s: string | null | undefined) => !q || (s ?? "").toLowerCase().includes(q);
  return {
    products: [...families.values()].filter((f) => match(f.title) || match(f.brand) || f.asins.some((a) => match(a))).slice(0, 8),
    brands: [...new Set(rows.map((r) => r.brandName).filter(Boolean))].filter((b) => match(b)).slice(0, 5),
    groups: groups.filter((g) => match(g.name)).slice(0, 5).map((g) => ({ id: g.id, name: g.name, items: g.item_count })),
  };
});
