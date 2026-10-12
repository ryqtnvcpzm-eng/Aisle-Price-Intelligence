import { commitImport, commitSchema } from "@/server/catalog/import";
import { handle, rateLimit, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`commit:${ctx.user.id}`, 20, 60_000);
  const body = await readJson(req, (b) => commitSchema.parse(b));
  return commitImport(ctx, body);
});
