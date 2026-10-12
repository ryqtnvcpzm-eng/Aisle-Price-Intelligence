import { aiEnabled, explainInsights } from "@/server/ai/explain";
import { handle, rateLimit } from "@/server/http";
import { computeInsights } from "@/server/insights/engine";
import { requireApiContext } from "@/server/workspace/context";

export const POST = handle(async () => {
  const ctx = await requireApiContext();
  if (!aiEnabled()) return Response.json({ error: { message: "AI explanations aren't configured (ANTHROPIC_API_KEY)." } }, { status: 501 });
  rateLimit(`explain:${ctx.workspace.id}`, 6, 60_000);
  const insights = await computeInsights(ctx.workspace.id, { significantPct: ctx.workspace.settings.significantChangePct });
  const result = await explainInsights(insights);
  return { summary: result?.text ?? null, model: result?.model ?? null, basedOn: insights.length };
});
