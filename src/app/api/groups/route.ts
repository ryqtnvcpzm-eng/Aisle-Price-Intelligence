import { listGroups } from "@/server/catalog/queries";
import { createGroup, groupSchema } from "@/server/comparison/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { groups: await listGroups(ctx.workspace.id) };
});

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const body = await readJson(req, (b) => groupSchema.parse(b));
  return { group: await createGroup(ctx, body) };
});
