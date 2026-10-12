import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { logActivity } from "../activity";
import { db } from "../db/client";
import { alertEvents, alertRules, comparisonGroups, notifications, variants } from "../db/schema";
import { HttpError } from "../errors";
import type { AppContext } from "../workspace/context";
import { deliverAlertEvent } from "./deliver";

export const ALERT_TYPES = {
  price_below: { label: "Price drops below", scope: "variant_or_group", needs: "thresholdMinor" },
  price_above: { label: "Price rises above", scope: "variant_or_group", needs: "thresholdMinor" },
  pct_drop: { label: "Price falls by %", scope: "variant_or_group", needs: "pct" },
  pct_rise: { label: "Price rises by %", scope: "variant_or_group", needs: "pct" },
  daily_move: { label: "Moves by % in 24h", scope: "variant_or_group", needs: "pct" },
  competitor_undercut: { label: "Competitor undercuts reference", scope: "group", needs: null },
  gap_exceeds: { label: "Price gap exceeds", scope: "group", needs: "gapPct" },
  leader_change: { label: "Price leader changes", scope: "group", needs: null },
  historical_low: { label: "Reaches an observed low", scope: "variant_or_group", needs: null },
  out_of_stock: { label: "Becomes unavailable", scope: "variant_or_group", needs: null },
  back_in_stock: { label: "Back in stock", scope: "variant_or_group", needs: null },
  stale_data: { label: "Hasn't refreshed", scope: "any", needs: "hours" },
  quota_exhausted: { label: "Provider quota exhausted", scope: "workspace", needs: null },
  monitoring_failures: { label: "Repeated monitoring failures", scope: "any", needs: "failures" },
} as const;
export type AlertTypeKey = keyof typeof ALERT_TYPES;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(Object.keys(ALERT_TYPES) as [AlertTypeKey, ...AlertTypeKey[]]),
  variantId: z.string().uuid().nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  params: z
    .object({
      thresholdMinor: z.number().int().positive().optional(),
      pct: z.number().positive().max(95).optional(),
      gapPct: z.number().positive().max(500).optional(),
      hours: z.number().int().min(1).max(168).optional(),
      failures: z.number().int().min(1).max(50).optional(),
      windowDays: z.number().int().min(7).max(365).optional(),
    })
    .default({}),
  frequency: z.enum(["instant", "daily", "weekly"]).default("instant"),
  channels: z.array(z.enum(["in_app", "email"])).min(1).default(["in_app"]),
  cooldownMinutes: z.number().int().min(15).max(10_080).default(360),
  quietHours: z.object({ start: hhmm, end: hhmm }).nullable().optional(),
  paused: z.boolean().optional(),
});

async function validateScope(ctx: AppContext, input: z.infer<typeof ruleSchema>) {
  const def = ALERT_TYPES[input.type];
  if (def.needs && (input.params as Record<string, unknown>)[def.needs] === undefined) throw new HttpError(400, `This alert needs a ${def.needs === "thresholdMinor" ? "price threshold" : def.needs === "pct" ? "percentage" : def.needs}.`);
  if (def.scope === "group" && !input.groupId) throw new HttpError(400, "Choose a comparison group for this alert.");
  if (def.scope === "variant_or_group" && !input.groupId && !input.variantId) throw new HttpError(400, "Choose a product or a comparison group.");
  if (input.variantId) {
    const [v] = await db.select({ id: variants.id }).from(variants).where(and(eq(variants.id, input.variantId), eq(variants.workspaceId, ctx.workspace.id)));
    if (!v) throw new HttpError(404, "Product not found.");
  }
  if (input.groupId) {
    const [g] = await db.select({ id: comparisonGroups.id }).from(comparisonGroups).where(and(eq(comparisonGroups.id, input.groupId), eq(comparisonGroups.workspaceId, ctx.workspace.id)));
    if (!g) throw new HttpError(404, "Comparison not found.");
  }
}

export async function listRules(workspaceId: string) {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select r.*, g.name group_name, f.title family_title, v.label variant_label,
      (select count(*)::int from alert_events e where e.rule_id = r.id) event_count
    from alert_rules r
      left join comparison_groups g on g.id = r.group_id
      left join variants v on v.id = r.variant_id
      left join product_families f on f.id = v.family_id
    where r.workspace_id = ${workspaceId} order by r.created_at desc`);
  return rows;
}

export async function createRule(ctx: AppContext, input: z.infer<typeof ruleSchema>) {
  await validateScope(ctx, input);
  const [r] = await db
    .insert(alertRules)
    .values({ workspaceId: ctx.workspace.id, createdBy: ctx.user.id, name: input.name, type: input.type, variantId: input.variantId ?? null, groupId: input.groupId ?? null, params: input.params, frequency: input.frequency, channels: input.channels, cooldownMinutes: input.cooldownMinutes, quietHours: input.quietHours ?? null, paused: input.paused ?? false })
    .returning();
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "alert_created", message: `Created alert “${r!.name}”`, entityType: "alert", entityId: r!.id });
  return r!;
}

export async function updateRule(ctx: AppContext, id: string, input: Partial<z.infer<typeof ruleSchema>>) {
  const [existing] = await db.select().from(alertRules).where(and(eq(alertRules.id, id), eq(alertRules.workspaceId, ctx.workspace.id)));
  if (!existing) throw new HttpError(404, "Alert not found.");
  const merged = ruleSchema.parse({ ...existing, ...input, params: { ...existing.params, ...(input.params ?? {}) } });
  await validateScope(ctx, merged);
  await db.update(alertRules).set({ name: merged.name, variantId: merged.variantId ?? null, groupId: merged.groupId ?? null, params: merged.params, frequency: merged.frequency, channels: merged.channels, cooldownMinutes: merged.cooldownMinutes, quietHours: merged.quietHours ?? null, paused: merged.paused ?? false }).where(eq(alertRules.id, id));
}

export async function deleteRule(ctx: AppContext, id: string) {
  const res = await db.delete(alertRules).where(and(eq(alertRules.id, id), eq(alertRules.workspaceId, ctx.workspace.id))).returning({ name: alertRules.name });
  if (!res.length) throw new HttpError(404, "Alert not found.");
  await logActivity({ workspaceId: ctx.workspace.id, actorUserId: ctx.user.id, kind: "alert_deleted", message: `Deleted alert “${res[0]!.name}”` });
}

/** Explicit test notification — the only path that may email about non-live data. */
export async function sendTest(ctx: AppContext, id: string) {
  const [rule] = await db.select().from(alertRules).where(and(eq(alertRules.id, id), eq(alertRules.workspaceId, ctx.workspace.id)));
  if (!rule) throw new HttpError(404, "Alert not found.");
  const [ev] = await db
    .insert(alertEvents)
    .values({ ruleId: rule.id, workspaceId: ctx.workspace.id, headline: `Test: ${rule.name}`, detail: "This is a test notification. No price event occurred.", dedupeKey: `test:${Date.now()}`, isTest: true })
    .returning();
  const channels = await deliverAlertEvent(ev!, rule, { quiet: false });
  return { channels };
}

export async function listEvents(workspaceId: string, limit = 100) {
  return db.select().from(alertEvents).where(eq(alertEvents.workspaceId, workspaceId)).orderBy(desc(alertEvents.firedAt)).limit(limit);
}

export async function listNotifications(ctx: AppContext, limit = 40) {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.workspaceId, ctx.workspace.id), sql`(${notifications.userId} is null or ${notifications.userId} = ${ctx.user.id})`))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [{ unread } = { unread: 0 }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, ctx.workspace.id), isNull(notifications.readAt)));
  return { notifications: rows, unread };
}

export async function markRead(ctx: AppContext, ids: string[] | "all") {
  const base = and(eq(notifications.workspaceId, ctx.workspace.id), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids === "all" ? base : and(base, sql`${notifications.id} in ${ids}`));
}
