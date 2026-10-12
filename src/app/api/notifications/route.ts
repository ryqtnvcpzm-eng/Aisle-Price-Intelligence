import { z } from "zod";
import { listNotifications, markRead } from "@/server/alerts/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => listNotifications(await requireApiContext()));

export const POST = handle(async (req) => {
  const ctx = await requireApiContext();
  const { ids } = await readJson(req, (b) => z.object({ ids: z.union([z.literal("all"), z.array(z.string().uuid()).max(200)]) }).parse(b));
  await markRead(ctx, ids);
  return { ok: true };
});
