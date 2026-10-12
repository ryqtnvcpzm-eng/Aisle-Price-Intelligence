import { briefing } from "@/server/ai/explain";
import { handle, rateLimit } from "@/server/http";
import { computeInsights } from "@/server/insights/engine";
import { requireApiContext } from "@/server/workspace/context";

export const POST = handle(async () => {
  const ctx = await requireApiContext();
  rateLimit(`explain:${ctx.workspace.id}`, 6, 60_000);
  const insights = await computeInsights(ctx.workspace.id, { significantPct: ctx.workspace.settings.significantChangePct });
  const result = await briefing(insights);
  return { summary: result.text, model: result.model, source: result.source, basedOn: insights.length };
});
