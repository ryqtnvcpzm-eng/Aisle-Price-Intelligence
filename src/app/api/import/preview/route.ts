import { z } from "zod";
import { isMarketplaceCode } from "@/lib/marketplaces";
import { previewImport } from "@/server/catalog/import";
import { handle, rateLimit, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

const schema = z.object({
  input: z.string().min(1).max(20_000),
  marketplace: z.string().refine(isMarketplaceCode).nullable().optional(),
});

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`preview:${ctx.user.id}`, 30, 60_000);
  const body = await readJson(req, (b) => schema.parse(b));
  return previewImport(ctx, body.input, (body.marketplace as never) ?? null);
});
