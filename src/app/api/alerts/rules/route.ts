import { createRule, listRules, ruleSchema } from "@/server/alerts/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { rules: await listRules(ctx.workspace.id) };
});

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  return { rule: await createRule(ctx, await readJson(req, (b) => ruleSchema.parse(b))) };
});
