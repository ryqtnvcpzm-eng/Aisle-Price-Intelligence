import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { formatMoney, formatPct } from "@/lib/money";
import { lastCompletedWeek, weekLabel, weekStarting, type Week } from "@/lib/week";
import { logActivity } from "../activity";
import { db } from "../db/client";
import { briefings, workspaces, type Briefing } from "../db/schema";
import { env } from "../env";
import { HttpError } from "../errors";
import { logger } from "../logger";
import { emailStatus, sendEmailNow, workspaceRecipients } from "../notifications/email";
import { briefingEmail } from "../notifications/templates";
import { buildBriefing } from "./build";

export type StoredBriefing = Briefing;

async function workspaceZone(workspaceId: string) {
  const [ws] = await db.select({ timeZone: workspaces.timeZone, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw new HttpError(404, "Workspace not found.");
  return ws;
}

/**
 * Get (or build and store) the briefing for a week — by default the last
 * finished Monday–Sunday in the workspace's time zone. Idempotent: calling it
 * again returns the stored briefing; `force` rebuilds it in place (version + 1)
 * so links to it keep working.
 */
export async function ensureBriefing(workspaceId: string, opts: { weekStart?: string; force?: boolean; actorUserId?: string | null; now?: Date } = {}): Promise<{ briefing: StoredBriefing; created: boolean }> {
  const ws = await workspaceZone(workspaceId);
  const week: Week = opts.weekStart ? weekStarting(opts.weekStart, ws.timeZone) : lastCompletedWeek(ws.timeZone, opts.now);
  if (week.periodEnd.getTime() > (opts.now ?? new Date()).getTime()) throw new HttpError(400, "That week hasn't finished yet.");
  const [existing] = await db.select().from(briefings).where(and(eq(briefings.workspaceId, workspaceId), eq(briefings.weekStart, week.weekStart)));
  if (existing && !opts.force) return { briefing: existing, created: false };

  const built = await buildBriefing(workspaceId, week);
  const values = { workspaceId, weekStart: week.weekStart, weekEnd: week.weekEnd, timeZone: week.timeZone, periodStart: week.periodStart, periodEnd: week.periodEnd, referenceBrandId: built.referenceBrand?.id ?? null, referenceBrandName: built.referenceBrand?.name ?? null, content: built.content, containsSimulated: built.containsSimulated, generatedBy: opts.actorUserId ?? null, generatedAt: new Date() };
  const [row] = await db
    .insert(briefings)
    .values(values)
    .onConflictDoUpdate({ target: [briefings.workspaceId, briefings.weekStart], set: { ...values, version: existing ? existing.version + 1 : 1 } })
    .returning();
  if (!existing) await logActivity({ workspaceId, actorUserId: opts.actorUserId ?? null, kind: "briefing", message: `Monday Briefing ready for ${weekLabel(week)}`, entityType: "briefing", entityId: row!.id, isSimulated: built.containsSimulated });
  return { briefing: row!, created: !existing };
}

export async function listBriefings(workspaceId: string, limit = 26) {
  return db
    .select({ id: briefings.id, weekStart: briefings.weekStart, weekEnd: briefings.weekEnd, containsSimulated: briefings.containsSimulated, generatedAt: briefings.generatedAt, version: briefings.version })
    .from(briefings)
    .where(eq(briefings.workspaceId, workspaceId))
    .orderBy(desc(briefings.weekStart))
    .limit(limit);
}

export async function getBriefing(workspaceId: string, weekStart?: string): Promise<StoredBriefing | null> {
  const q = db.select().from(briefings);
  const [row] = weekStart ? await q.where(and(eq(briefings.workspaceId, workspaceId), eq(briefings.weekStart, weekStart))) : await q.where(eq(briefings.workspaceId, workspaceId)).orderBy(desc(briefings.weekStart)).limit(1);
  return row ?? null;
}

/** Email the briefing once per member and week (real data only, when the workspace opted in). */
export async function emailBriefingIfEnabled(b: StoredBriefing) {
  const ws = await workspaceZone(b.workspaceId);
  if (!ws.settings.emailBriefing || b.containsSimulated || emailStatus().mode === "not_configured") return 0;
  const c = b.content;
  const sections = [
    ...(c.movers.down.length ? [{ heading: "Biggest decreases", lines: c.movers.down.map((m) => `${m.listing.brandName ?? ""} ${m.listing.name}: ${formatMoney(m.from, m.currency)} → ${formatMoney(m.to, m.currency)} (${formatPct(m.ratio, { signed: true })})`.trim()) }] : []),
    ...(c.drops.length ? [{ heading: "Drops of 5% or more", lines: c.drops.slice(0, 8).map((d) => `${d.listing.brandName ?? ""} ${d.listing.name}: ${formatPct(d.ratio, { signed: true })}`.trim()) }] : []),
    { heading: "Data confidence", lines: c.confidence.notes },
  ];
  const email = briefingEmail({ weekLabel: weekLabel({ weekStart: b.weekStart, weekEnd: b.weekEnd }), summary: c.summary.sentences, sections, url: `${env.BETTER_AUTH_URL}/briefing/${b.weekStart}`, simulated: b.containsSimulated });
  let n = 0;
  for (const r of await workspaceRecipients(b.workspaceId)) {
    await sendEmailNow({ workspaceId: b.workspaceId, userId: r.userId, recipient: r.email, kind: "briefing", email, idempotencyKey: `briefing:${b.workspaceId}:${b.weekStart}:${r.userId}`, briefingId: b.id });
    n++;
  }
  return n;
}

/** Scheduler entry point: make sure every onboarded workspace has last week's briefing. Safe to run often. */
export async function generateDueBriefings(now = new Date()) {
  const all = await db.select({ id: workspaces.id }).from(workspaces).where(isNotNull(workspaces.onboardedAt));
  let created = 0;
  for (const w of all) {
    try {
      const r = await ensureBriefing(w.id, { now });
      if (r.created) {
        created++;
        await emailBriefingIfEnabled(r.briefing);
      }
    } catch (e) {
      logger.warn({ err: e, workspace: w.id }, "briefing generation failed");
    }
  }
  return { workspaces: all.length, created };
}
