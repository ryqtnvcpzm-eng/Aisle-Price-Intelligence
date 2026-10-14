import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";
import { env } from "@/server/env";
import { handle, rateLimit } from "@/server/http";
import { emailStatus, sendEmailNow } from "@/server/notifications/email";
import { testEmail } from "@/server/notifications/templates";
import { requireApiContext } from "@/server/workspace/context";

/** Send a test email to the signed-in person only — never to the rest of the workspace. */
export const POST = handle(async () => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`test-email:${ctx.user.id}`, 3, 60_000);
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ctx.workspace.id));
  const d = await sendEmailNow({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    recipient: ctx.user.email,
    kind: "test",
    email: testEmail({ workspaceName: ws?.name ?? "Aisle", url: env.BETTER_AUTH_URL, recipient: ctx.user.email }),
    idempotencyKey: `test:${ctx.user.id}:${Date.now()}`,
    isTest: true,
  });
  return { delivery: { id: d.id, status: d.status, reason: d.lastError, recipient: d.recipient }, mode: emailStatus().mode };
});
