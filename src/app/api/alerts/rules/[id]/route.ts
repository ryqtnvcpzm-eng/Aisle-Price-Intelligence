import { z } from "zod";
import { deleteRule, ruleSchema, updateRule } from "@/server/alerts/service";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const ctx = await requireApiContext("analyst");
  await updateRule(ctx, z.string().uuid().parse((await params).id), await readJson(req, (b) => ruleSchema.partial().parse(b)));
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const ctx = await requireApiContext("analyst");
  await deleteRule(ctx, z.string().uuid().parse((await params).id));
  return { ok: true };
});
