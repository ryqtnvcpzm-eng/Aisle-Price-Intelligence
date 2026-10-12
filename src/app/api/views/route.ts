import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { savedViews } from "@/server/db/schema";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async (req) => {
  const ctx = await requireApiContext();
  const scope = z.string().max(80).parse(req.nextUrl.searchParams.get("scope") ?? "products");
  return { views: await db.select().from(savedViews).where(and(eq(savedViews.workspaceId, ctx.workspace.id), eq(savedViews.scope, scope))).orderBy(desc(savedViews.createdAt)) };
});

const schema = z.object({ scope: z.string().max(80), name: z.string().trim().min(1).max(60), state: z.record(z.string(), z.unknown()) });

export const POST = handle(async (req) => {
  const ctx = await requireApiContext();
  const b = await readJson(req, (x) => schema.parse(x));
  if (JSON.stringify(b.state).length > 8000) return Response.json({ error: { message: "View is too large." } }, { status: 400 });
  const [v] = await db.insert(savedViews).values({ workspaceId: ctx.workspace.id, userId: ctx.user.id, scope: b.scope, name: b.name, state: b.state }).returning();
  return { view: v };
});

export const DELETE = handle(async (req) => {
  const ctx = await requireApiContext();
  const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.workspaceId, ctx.workspace.id)));
  return { ok: true };
});
