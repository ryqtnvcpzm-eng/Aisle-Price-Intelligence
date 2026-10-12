import { z } from "zod";
import { listingRowsForVariants } from "@/server/catalog/mutations";
import { handle, rateLimit, readJson } from "@/server/http";
import { jobStatuses, requestManualRefresh } from "@/server/monitoring/scheduler";
import { requireApiContext } from "@/server/workspace/context";

const schema = z.object({ variantIds: z.array(z.string().uuid()).min(1).max(500) });

/** Manual refresh: enqueues provider-sized, idempotent jobs for the worker. */
export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`refresh:${ctx.workspace.id}`, 12, 60_000);
  const { variantIds } = await readJson(req, (b) => schema.parse(b));
  const rows = await listingRowsForVariants(ctx.workspace.id, variantIds);
  const jobIds = await requestManualRefresh({ workspaceId: ctx.workspace.id, userId: ctx.user.id, listingRows: rows });
  return { jobIds, listings: rows.length };
});

export const GET = handle(async (req) => {
  const ctx = await requireApiContext();
  const ids = z.array(z.string().uuid()).max(50).parse((req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean));
  return { jobs: await jobStatuses(ids, ctx.workspace.id) };
});
