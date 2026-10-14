import { z } from "zod";
import { disableProtection, enableProtection, protectionStatus } from "@/server/alerts/protection";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return protectionStatus(ctx.workspace.id);
});

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const { enabled } = await readJson(req, (b) => z.object({ enabled: z.boolean() }).parse(b));
  const actor = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
  if (!enabled) {
    await disableProtection(actor);
    return { enabled: false };
  }
  return { enabled: true, ...(await enableProtection(actor)) };
});
