import { z } from "zod";
import { familyPatchSchema, patchFamilies } from "@/server/catalog/mutations";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), patch: familyPatchSchema });

export const PATCH = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const { ids, patch } = await readJson(req, (b) => schema.parse(b));
  await patchFamilies(ctx, ids, patch);
  return { ok: true };
});
