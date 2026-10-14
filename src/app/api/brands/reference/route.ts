import { planReferenceChange, referenceInputSchema, referenceOverview, setReferenceBrand } from "@/server/brand/reference";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

/** Without parameters: the current brand and its managed comparisons. With ?brandId= or ?brandName=: a dry-run plan. */
export const GET = handle(async (req) => {
  const ctx = await requireApiContext();
  const q = req.nextUrl.searchParams;
  const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
  if (q.has("brandId")) return { plan: await planReferenceChange(actor, referenceInputSchema.parse({ brandId: q.get("brandId") || null })) };
  if (q.has("brandName")) return { plan: await planReferenceChange(actor, referenceInputSchema.parse({ brandName: q.get("brandName") })) };
  return referenceOverview(ctx.workspace.id);
});

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const input = await readJson(req, (b) => referenceInputSchema.parse(b));
  return setReferenceBrand({ workspaceId: ctx.workspace.id, userId: ctx.user.id }, input);
});
