import { z } from "zod";
import { deleteQuantity, quantitySchema, setQuantity } from "@/server/catalog/mutations";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const { id } = await params;
  z.string().uuid().parse(id);
  await setQuantity(ctx, id, await readJson(req, (b) => quantitySchema.parse(b)));
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const { id } = await params;
  const dim = z.enum(["mass", "volume", "count", "serving"]).parse(req.nextUrl.searchParams.get("dimension"));
  await deleteQuantity(ctx, z.string().uuid().parse(id), dim);
  return { ok: true };
});
