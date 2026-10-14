import { captureTokenStatus, generateCaptureToken, revokeCaptureToken } from "@/server/capture/tokens";
import { handle, rateLimit } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  return { token: await captureTokenStatus(ctx) };
});

/** Generate (or regenerate) the capture token. The plaintext is returned exactly once. */
export const POST = handle(async () => {
  const ctx = await requireApiContext("analyst");
  rateLimit(`capture-token:${ctx.user.id}`, 5, 60_000);
  return generateCaptureToken(ctx);
});

export const DELETE = handle(async () => {
  const ctx = await requireApiContext("analyst");
  await revokeCaptureToken(ctx);
  return { ok: true };
});
