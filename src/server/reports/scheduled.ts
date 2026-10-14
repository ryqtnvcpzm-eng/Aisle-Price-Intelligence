import "server-only";
import { eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { reportDefinitions, reportRuns } from "../db/schema";
import { env } from "../env";
import { sendEmailNow, workspaceRecipients } from "../notifications/email";
import { reportReadyEmail } from "../notifications/templates";
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
      const [run] = await db.insert(reportRuns).values({ workspaceId: d.workspaceId, definitionId: d.id, type: d.type, params: d.params, format: d.format, rowCount: rows, dataAsOf: data.dataAsOf ? new Date(data.dataAsOf) : null, containsSimulated: data.containsSimulated }).returning({ id: reportRuns.id });
      await db.update(reportDefinitions).set({ lastRunAt: now }).where(eq(reportDefinitions.id, d.id));
      if (!data.containsSimulated) {
        const email = reportReadyEmail({ name: d.name, title: data.title, subtitle: data.subtitle, url: `${env.BETTER_AUTH_URL}/reports` });
        for (const r of await workspaceRecipients(d.workspaceId)) {
          await sendEmailNow({ workspaceId: d.workspaceId, userId: r.userId, recipient: r.email, kind: "report", email, idempotencyKey: `report:${run!.id}:${r.userId}` });
        }
      }
      ran++;
    } catch (e) {
      logger.warn({ err: e, def: d.id }, "scheduled report failed");
    }
  }
  return { ran };
}
