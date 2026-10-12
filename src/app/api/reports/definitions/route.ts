import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { reportDefinitions, reportRuns } from "@/server/db/schema";
import { handle, readJson } from "@/server/http";
import { reportParamsSchema } from "@/server/reports/build";
import { requireApiContext } from "@/server/workspace/context";

export const GET = handle(async () => {
  const ctx = await requireApiContext();
  const defs = await db.select().from(reportDefinitions).where(eq(reportDefinitions.workspaceId, ctx.workspace.id)).orderBy(desc(reportDefinitions.createdAt));
  const runs = await db.select().from(reportRuns).where(eq(reportRuns.workspaceId, ctx.workspace.id)).orderBy(desc(reportRuns.createdAt)).limit(20);
  return { definitions: defs, runs };
});

const schema = z.object({ name: z.string().trim().min(1).max(80), schedule: z.enum(["none", "daily", "weekly"]).default("none"), params: reportParamsSchema });

export const POST = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const b = await readJson(req, (x) => schema.parse(x));
  const { type, format, ...params } = b.params;
  const [d] = await db.insert(reportDefinitions).values({ workspaceId: ctx.workspace.id, createdBy: ctx.user.id, name: b.name, type, format, params, schedule: b.schedule }).returning();
  return { definition: d };
});

export const DELETE = handle(async (req) => {
  const ctx = await requireApiContext("analyst");
  const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
  await db.delete(reportDefinitions).where(and(eq(reportDefinitions.id, id), eq(reportDefinitions.workspaceId, ctx.workspace.id)));
  return { ok: true };
});
