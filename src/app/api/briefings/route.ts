import { z } from "zod";
import { isWeekStart } from "@/lib/week";
import { emailBriefingIfEnabled, ensureBriefing, listBriefings } from "@/server/briefing/service";
import { handle, rateLimit, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { briefings: await listBriefings(ctx.workspace.id) };
});

const schema = z.object({ weekStart: z.string().refine(isWeekStart, "Must be a Monday (YYYY-MM-DD)").optional(), force: z.boolean().optional() });

/** Generate (or, with force, rebuild) a finished week's briefing. Without a week: the last finished one. */
export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`briefing:${ctx.workspace.id}`, 6, 60_000);
  const body = await readJson(req, (b) => schema.parse(b ?? {}));
  const r = await ensureBriefing(ctx.workspace.id, { weekStart: body.weekStart, force: body.force, actorUserId: ctx.user.id });
  if (r.created) await emailBriefingIfEnabled(r.briefing);
  return { weekStart: r.briefing.weekStart, created: r.created, version: r.briefing.version };
});
