import { createImportJob, createJobSchema, listJobs } from "@/server/catalog/bulk-import";
import { handle, rateLimit, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { jobs: await listJobs(ctx.workspace.id) };
});

/** Queue a bulk import. Processing happens in chunks of 25 (see /process and the worker). */
export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`import-job:${ctx.user.id}`, 5, 60_000);
  const job = await createImportJob(ctx, await readJson(req, (b) => createJobSchema.parse(b)));
  return { job: { id: job.id, total: job.total } };
});
