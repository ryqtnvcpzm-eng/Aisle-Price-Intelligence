import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { sendEmail } from "../alerts/deliver";
import { db } from "../db/client";
import { reportDefinitions, reportRuns, user, workspaceMembers } from "../db/schema";
import { logger } from "../logger";
import { buildReport, reportParamsSchema } from "./build";

/**
 * Recurring reports: regenerate saved definitions on their schedule and email a
 * summary (attachments are intentionally not emailed; the run is downloadable in-app).
 */
export async function runScheduledReports(now = new Date()) {
  const defs = await db.select().from(reportDefinitions).where(ne(reportDefinitions.schedule, "none"));
  let ran = 0;
  for (const d of defs) {
    const due = !d.lastRunAt || (d.schedule === "daily" ? now.getTime() - d.lastRunAt.getTime() > 20 * 3_600_000 : now.getTime() - d.lastRunAt.getTime() > 6.5 * 86_400_000);
    if (!due) continue;
    try {
      const params = reportParamsSchema.parse({ ...d.params, type: d.type, format: d.format });
      const data = await buildReport(d.workspaceId, params);
      const rows = data.sections.reduce((s, x) => s + x.rows.length, 0);
      await db.insert(reportRuns).values({ workspaceId: d.workspaceId, definitionId: d.id, type: d.type, params: d.params, format: d.format, rowCount: rows, dataAsOf: data.dataAsOf ? new Date(data.dataAsOf) : null, containsSimulated: data.containsSimulated });
      await db.update(reportDefinitions).set({ lastRunAt: now }).where(eq(reportDefinitions.id, d.id));
      if (!data.containsSimulated) {
        const to = await db.select({ email: user.email }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.workspaceId, d.workspaceId)));
        await sendEmail(to.map((t) => t.email), `Aisle report ready: ${d.name}`, `${data.title}\n${data.subtitle}\nOpen Aisle → Reports to download.`);
      }
      ran++;
    } catch (e) {
      logger.warn({ err: e, def: d.id }, "scheduled report failed");
    }
  }
  return { ran };
}
