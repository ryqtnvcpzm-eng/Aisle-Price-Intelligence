import { db } from "@/server/db/client";
import { reportRuns } from "@/server/db/schema";
import { handle, rateLimit, readJson } from "@/server/http";
import { buildReport, reportParamsSchema } from "@/server/reports/build";
import { renderReport } from "@/server/reports/render";
import { requireApiContext } from "@/server/workspace/context";

export const runtime = "nodejs";

/** Build and stream a report file. Every run is recorded for reproducibility. */
export const POST = handle(async (req) => {
  const ctx = await requireApiContext();
  rateLimit(`export:${ctx.user.id}`, 20, 60_000);
  const params = await readJson(req, (b) => reportParamsSchema.parse(b));
  const data = await buildReport(ctx.workspace.id, params);
  const file = await renderReport(data, params.format);
  const { format: _f, type: _t, ...rest } = params;
  await db.insert(reportRuns).values({
    workspaceId: ctx.workspace.id,
    type: params.type,
    params: rest,
    format: params.format,
    rowCount: data.sections.reduce((s, x) => s + x.rows.length, 0),
    dataAsOf: data.dataAsOf ? new Date(data.dataAsOf) : null,
    containsSimulated: data.containsSimulated,
    requestedBy: ctx.user.id,
  });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Aisle-Simulated": data.containsSimulated ? "1" : "0",
    },
  });
});
