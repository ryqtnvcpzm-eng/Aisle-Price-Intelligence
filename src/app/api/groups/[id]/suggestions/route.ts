import { z } from "zod";
import { getGroup, suggestForGroup } from "@/server/comparison/service";
import { handle } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  const gid = z.string().uuid().parse((await params).id);
  await getGroup(ctx.workspace.id, gid);
  return { suggestions: await suggestForGroup(ctx.workspace.id, gid) };
});
