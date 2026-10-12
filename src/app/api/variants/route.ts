import { z } from "zod";
import { listVariantRows } from "@/server/catalog/queries";
import { patchVariants, variantPatchSchema } from "@/server/catalog/mutations";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { rows: await listVariantRows(ctx.workspace.id) };
});

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), patch: variantPatchSchema });

export const PATCH = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const { ids, patch } = await readJson(req, (b) => schema.parse(b));
  await patchVariants(ctx, ids, patch);
  return { ok: true };
});
