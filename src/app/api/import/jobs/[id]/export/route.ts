import { z } from "zod";
import { exportJobCsv } from "@/server/catalog/bulk-import";
import { handle } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const id = z.string().uuid().parse((await params).id);
  const csv = await exportJobCsv(ctx.workspace.id, id);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="aisle-import-${id.slice(0, 8)}.csv"`, "Cache-Control": "no-store" } });
});
