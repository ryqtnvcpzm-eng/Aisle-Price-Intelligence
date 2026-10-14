import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { handle } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

/** Brands in this workspace with how many tracked listings each has — for "Which brand is yours?". */
export const GET = handle(async () => {
  const ctx = await requireApiContext();
  const rows = await db.execute<{ id: string; name: string; is_reference: boolean; listings: number }>(sql`
    select b.id, b.name, b.is_reference, count(v.id)::int listings
    from brands b
      left join product_families f on f.brand_id = b.id and f.archived_at is null
      left join variants v on v.family_id = f.id and v.tracked
    where b.workspace_id = ${ctx.workspace.id}
    group by b.id order by b.is_reference desc, count(v.id) desc, b.name`);
  return { brands: rows.map((r) => ({ id: r.id, name: r.name, isReference: r.is_reference, listings: r.listings })) };
});
