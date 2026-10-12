import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "../auth";
import { db } from "../db/client";
import { workspaceMembers, workspaces, type Workspace } from "../db/schema";

export type Role = "owner" | "admin" | "analyst" | "viewer";

export interface AppContext {
  user: { id: string; name: string; email: string };
  workspace: Workspace;
  role: Role;
}

export { HttpError } from "../errors";
import { HttpError } from "../errors";

/** Resolve the signed-in user and their active workspace. Cached per request. */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) return null;
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, session.user.id))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    workspace: row.workspace,
    role: row.role,
  };
});

/** For server components / pages: redirect to sign-in when unauthenticated. */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}

/** For route handlers: throw a 401 that `handle()` turns into JSON. */
export async function requireApiContext(minRole: Role = "viewer"): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new HttpError(401, "Sign in to continue.", "unauthenticated");
  const rank: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 };
  if (rank[ctx.role] < rank[minRole]) throw new HttpError(403, "You don't have permission to do that.", "forbidden");
  return ctx;
}

export async function assertMembership(userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  if (!rows.length) throw new HttpError(404, "Not found");
}
