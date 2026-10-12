import { z } from "zod";
import { reorderItems } from "@/server/comparison/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const { itemIds } = await readJson(req, (b) => z.object({ itemIds: z.array(z.string().uuid()).max(500) }).parse(b));
  await reorderItems(ctx, z.string().uuid().parse((await params).id), itemIds);
  return { ok: true };
});
