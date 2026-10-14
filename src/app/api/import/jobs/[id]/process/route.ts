import { z } from "zod";
import { getJob, processNextChunk } from "@/server/catalog/bulk-import";
import { handle, rateLimit } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

/** Process the next chunk of 25 links. The open progress page calls this in a loop; the worker does the same. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext("analyst");
  const id = z.string().uuid().parse((await params).id);
  rateLimit(`import-process:${id}`, 30, 60_000);
  await getJob(ctx.workspace.id, id); // workspace check
  return processNextChunk(id);
});
