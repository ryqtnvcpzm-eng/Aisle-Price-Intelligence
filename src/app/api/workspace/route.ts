import { eq } from "drizzle-orm";
import { z } from "zod";
import { isMarketplaceCode } from "@/lib/marketplaces";
import { isNormalizationBasis } from "@/lib/quantity";
import { logActivity } from "@/server/activity";
import { db } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";
import { handle, readJson } from "@/server/http";
import { requireApiContext } from "@/server/workspace/context";

const schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  defaultMarketplace: z.string().refine(isMarketplaceCode).optional(),
  defaultCurrency: z.string().length(3).nullable().optional(),
  defaultBasis: z.string().refine(isNormalizationBasis).optional(),
  timeZone: z.string().max(60).optional(),
  onboarded: z.boolean().optional(),
  settings: z
    .object({
      defaultIntervalMinutes: z.union([z.literal(60), z.literal(180), z.literal(360), z.literal(720), z.literal(1440)]).optional(),
      digest: z.enum(["off", "daily", "weekly"]).optional(),
      emailAlerts: z.boolean().optional(),
      exportIncludeMethodology: z.boolean().optional(),
      significantChangePct: z.number().min(0.5).max(50).optional(),
      marketplaceIntervals: z.record(z.string(), z.number().int().min(60).max(1440)).optional(),
    })
    .optional(),
});

export const PATCH = handle(async (req) => {
  const ctx = await requireApiContext("admin");
  const b = await readJson(req, (x) => schema.parse(x));
  if (b.timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timeZone });
    } catch {
      return Response.json({ error: { message: "Unknown time zone." } }, { status: 400 });
    }
  }
  await db
    .update(workspaces)
    .set({
      ...(b.name ? { name: b.name } : {}),
      ...(b.defaultMarketplace ? { defaultMarketplace: b.defaultMarketplace } : {}),
      ...(b.defaultCurrency !== undefined ? { defaultCurrency: b.defaultCurrency } : {}),
      ...(b.defaultBasis ? { defaultBasis: b.defaultBasis } : {}),
      ...(b.timeZone ? { timeZone: b.timeZone } : {}),
      ...(b.onboarded ? { onboardedAt: new Date() } : {}),
      ...(b.settings ? { settings: { ...ctx.workspace.settings, ...b.settings } } : {}),
    })
    .where(eq(workspaces.id, ctx.workspace.id));
  if (b.settings || b.defaultMarketplace) await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "settings", message: "Updated workspace settings", metadata: b });
  return { ok: true };
});
