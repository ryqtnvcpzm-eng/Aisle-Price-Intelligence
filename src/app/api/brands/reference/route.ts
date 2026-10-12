import { z } from "zod";
import { setReferenceBrand } from "@/server/catalog/mutations";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const { brandId } = await readJson(req, (b) => z.object({ brandId: z.string().uuid().nullable() }).parse(b));
  await setReferenceBrand(ctx, brandId);
  return { ok: true };
});
