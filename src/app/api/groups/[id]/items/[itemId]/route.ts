import { z } from "zod";
import { itemPatchSchema, updateItem } from "@/server/comparison/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const p = await params;
  await updateItem(ctx, z.string().uuid().parse(p.id), z.string().uuid().parse(p.itemId), await readJson(req, (b) => itemPatchSchema.parse(b)));
  return { ok: true };
});
