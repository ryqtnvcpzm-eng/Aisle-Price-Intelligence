import { z } from "zod";
import { getJob, jobAction, jobActionSchema, listItems } from "@/server/catalog/bulk-import";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext();
  const id = z.string().uuid().parse((await params).id);
  const q = req.nextUrl.searchParams;
  const [{ job, counts }, items] = await Promise.all([getJob(ctx.workspace.id, id), listItems(ctx.workspace.id, id, { status: q.get("status") ?? undefined, offset: Number(q.get("offset") ?? 0) || 0, limit: Number(q.get("limit") ?? 100) || 100 })]);
  return { job, counts, items };
});

/** Pause, resume, cancel, or retry the failed links. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const id = z.string().uuid().parse((await params).id);
  const { action } = await readJson(req, (b) => jobActionSchema.parse(b));
  return jobAction(ctx, id, action);
});
