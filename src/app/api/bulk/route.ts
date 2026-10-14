import { bulkEdit, bulkSchema } from "@/server/catalog/bulk";
import { handle, rateLimit, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

/** Bulk edit (brand, monitoring frequency, tags). Returns requested / updated / skipped / failed with reasons. */
export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`bulk:${ctx.user.id}`, 20, 60_000);
  return { result: await bulkEdit(ctx, await readJson(req, (b) => bulkSchema.parse(b))) };
});
