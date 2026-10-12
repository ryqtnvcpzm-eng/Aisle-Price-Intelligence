import { z } from "zod";
import { addItems, removeItems } from "@/server/comparison/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ variantIds: z.array(z.string().uuid()).min(1).max(200), status: z.enum(["confirmed", "suggested"]).optional() });

export const POST = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const b = await readJson(req, (x) => body.parse(x));
  return { added: await addItems(ctx, z.string().uuid().parse((await params).id), b.variantIds, b.status) };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const b = await readJson(req, (x) => body.parse(x));
  await removeItems(ctx, z.string().uuid().parse((await params).id), b.variantIds);
  return { ok: true };
});
