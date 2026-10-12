import { z } from "zod";
import { sendTest } from "@/server/alerts/service";
import { handle, rateLimit } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`test-alert:${ctx.user.id}`, 5, 60_000);
  return sendTest(ctx, z.string().uuid().parse((await params).id));
});
