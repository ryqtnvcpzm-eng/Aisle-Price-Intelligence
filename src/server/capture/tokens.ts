import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { logActivity } from "../activity";
import { db } from "../db/client";
import { apiTokens, user, workspaceMembers, workspaces } from "../db/schema";
import { HttpError } from "../errors";
import type { AppContext } from "../workspace/context";

/**
 * Personal capture tokens. A token is 256 random bits, shown once; only its
 * SHA-256 hash is stored. It can do exactly one thing: record captures into
 * the workspace it was created in, as the person who created it.
 */
const PREFIX = "aisle_cap_";

export const hashToken = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

/** Create a new token and revoke any previous one for this person and workspace. Returns the plaintext once. */
export async function generateCaptureToken(ctx: AppContext) {
  if (ctx.role === "viewer") throw new HttpError(403, "Viewers can't record captures.", "forbidden");
  const raw = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = await db.transaction(async (tx) => {
    await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.userId, ctx.user.id), eq(apiTokens.workspaceId, ctx.workspace.id), eq(apiTokens.purpose, "capture"), isNull(apiTokens.revokedAt)));
    const [r] = await tx.insert(apiTokens).values({ workspaceId: ctx.workspace.id, userId: ctx.user.id, purpose: "capture", tokenHash: hashToken(raw), prefix: raw.slice(0, PREFIX.length + 4) }).returning();
    return r!;
  });
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "capture_token", message: "Created a new price-capture token (earlier tokens stop working)" });
  return { token: raw, prefix: row.prefix, createdAt: row.createdAt };
}

export async function revokeCaptureToken(ctx: AppContext) {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.userId, ctx.user.id), eq(apiTokens.workspaceId, ctx.workspace.id), eq(apiTokens.purpose, "capture"), isNull(apiTokens.revokedAt)));
}

export async function captureTokenStatus(ctx: AppContext) {
  const [row] = await db
    .select({ prefix: apiTokens.prefix, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, ctx.user.id), eq(apiTokens.workspaceId, ctx.workspace.id), eq(apiTokens.purpose, "capture"), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a bearer token to the person and workspace it acts for. Fails closed:
 * unknown, revoked, or the person no longer an editor of that workspace.
 */
export async function verifyCaptureToken(raw: string): Promise<{ tokenId: string; ctx: AppContext }> {
  if (!raw.startsWith(PREFIX) || raw.length < PREFIX.length + 40 || raw.length > 128) throw new HttpError(401, "Invalid capture token.", "invalid_token");
  const [row] = await db
    .select({ tokenId: apiTokens.id, user, workspace: workspaces, role: workspaceMembers.role })
    .from(apiTokens)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, apiTokens.userId), eq(workspaceMembers.workspaceId, apiTokens.workspaceId)))
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .innerJoin(workspaces, eq(workspaces.id, apiTokens.workspaceId))
    .where(and(eq(apiTokens.tokenHash, hashToken(raw)), eq(apiTokens.purpose, "capture"), isNull(apiTokens.revokedAt)));
  if (!row || row.role === "viewer") throw new HttpError(401, "Invalid capture token.", "invalid_token");
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  return { tokenId: row.tokenId, ctx: { user: { id: row.user.id, name: row.user.name, email: row.user.email }, workspace: row.workspace, role: row.role } };
}
