import { z } from "zod";
import { getHistory } from "@/server/analytics/history";
import { handle } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

const schema = z.object({
  variants: z.array(z.string().uuid()).min(1).max(24),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const GET = handle(async (req) => {
  const ctx = await requireApiContext();
  const sp = req.nextUrl.searchParams;
  const q = schema.parse({ variants: (sp.get("variants") ?? "").split(",").filter(Boolean), from: sp.get("from"), to: sp.get("to") ?? new Date().toISOString() });
  return { series: await getHistory(ctx.workspace.id, q.variants, q.from, q.to), from: q.from.toISOString(), to: q.to.toISOString(), renderedAt: new Date().toISOString() };
});
