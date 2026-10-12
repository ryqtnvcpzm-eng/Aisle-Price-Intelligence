import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaceMembers, workspaces } from "../db/schema";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}

/** Every new account gets a private workspace so data is isolated from day one. */
export async function provisionWorkspaceForUser(u: { id: string; name: string; email: string }) {
  const existing = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, u.id)).limit(1);
  if (existing.length) return existing[0]!.workspaceId;
  const base = slugify(u.name || u.email.split("@")[0] || "workspace");
  const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const [ws] = await db
    .insert(workspaces)
    .values({ name: u.name ? `${u.name.split(" ")[0]}'s workspace` : "My workspace", slug })
    .returning();
  await db.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: u.id, role: "owner" });
  return ws!.id;
}
