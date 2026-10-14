import { z } from "zod";
import { HttpError } from "@/server/errors";
import { handle, rateLimit } from "@/server/http";
import { retryDelivery } from "@/server/notifications/email";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`retry-delivery:${ctx.user.id}`, 10, 60_000);
  const d = await retryDelivery(ctx.workspace.id, z.string().uuid().parse((await params).id));
  if (!d) throw new HttpError(404, "Only failed or skipped messages can be retried.");
  return { delivery: { id: d.id, status: d.status, reason: d.lastError } };
});
