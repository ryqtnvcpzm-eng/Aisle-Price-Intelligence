import { z } from "zod";
import { archiveGroup, getGroupDetail, groupSchema, updateGroup } from "@/server/comparison/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };
const id = z.string().uuid();

export const GET = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext();
  return getGroupDetail(ctx.workspace.id, id.parse((await params).id));
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const body = await readJson(req, (b) => groupSchema.partial().extend({ archived: z.boolean().optional() }).parse(b));
  const gid = id.parse((await params).id);
  if (body.archived !== undefined) await archiveGroup(ctx, gid, body.archived);
  await updateGroup(ctx, gid, body);
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext("analyst");
  await archiveGroup(ctx, id.parse((await params).id), true);
  return { ok: true };
});
