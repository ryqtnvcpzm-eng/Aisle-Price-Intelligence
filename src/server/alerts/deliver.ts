import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { alertEvents, notifications, user, workspaceMembers, type AlertRule } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";

type AlertEvent = typeof alertEvents.$inferSelect;

/**
 * Deliver an alert event:
 *  - always: an in-app notification (labelled simulated where applicable)
 *  - email: only for real (non-simulated) data, instant-frequency rules, outside
 *    quiet hours, when the rule opts in and a transactional provider is configured.
 *    Test notifications are the one explicit exception for simulated data.
 */
export async function deliverAlertEvent(ev: AlertEvent, rule: AlertRule, opts: { quiet: boolean }) {
  const channels: string[] = [];
  await db.insert(notifications).values({
    workspaceId: ev.workspaceId,
    kind: ev.isTest ? "test" : "alert",
    title: ev.headline,
    body: ev.detail,
    href: ev.variantId ? `/alerts?event=${ev.id}` : "/alerts",
    alertEventId: ev.id,
    isSimulated: ev.isSimulated,
  });
  channels.push("in_app");

  const wantsEmail = rule.channels.includes("email") && rule.frequency === "instant" && !opts.quiet;
  const emailAllowed = ev.isTest || !ev.isSimulated;
  if (wantsEmail && emailAllowed && env.RESEND_API_KEY) {
    const recipients = await db
      .select({ email: user.email })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ev.workspaceId));
    const ok = await sendEmail(
      recipients.map((r) => r.email),
      `${ev.isTest ? "[Test] " : ""}${ev.headline}`,
      `${ev.detail ?? ""}\n\n${ev.isSimulated ? "Note: based on SIMULATED demo data.\n" : ""}Open Aisle: ${env.BETTER_AUTH_URL}/alerts`,
    );
    if (ok) channels.push("email");
  }
  await db.update(alertEvents).set({ deliveredChannels: channels }).where(eq(alertEvents.id, ev.id));
  return channels;
}

/** Resend HTTP API. No SDK dependency; never logs the key. */
export async function sendEmail(to: string[], subject: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn({ status: res.status }, "email send failed");
    return res.ok;
  } catch (e) {
    logger.warn({ err: e }, "email send error");
    return false;
  }
}

/** Daily/weekly digest of undigested events per workspace (real data only). */
export async function sendDigests(frequency: "daily" | "weekly") {
  const { and, gte, isNull } = await import("drizzle-orm");
  const since = new Date(Date.now() - (frequency === "daily" ? 1 : 7) * 86_400_000);
  const events = await db
    .select()
    .from(alertEvents)
    .where(and(isNull(alertEvents.digestSentAt), gte(alertEvents.firedAt, since), eq(alertEvents.isSimulated, false), eq(alertEvents.isTest, false)));
  const byWs = new Map<string, AlertEvent[]>();
  for (const e of events) byWs.set(e.workspaceId, [...(byWs.get(e.workspaceId) ?? []), e]);
  for (const [ws, evs] of byWs) {
    const recipients = await db.select({ email: user.email }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, ws));
    const body = evs.map((e) => `• ${e.headline}${e.detail ? ` — ${e.detail}` : ""}`).join("\n");
    await sendEmail(recipients.map((r) => r.email), `Aisle ${frequency} digest: ${evs.length} alert${evs.length === 1 ? "" : "s"}`, body);
    await db.update(alertEvents).set({ digestSentAt: new Date() }).where(inArray(alertEvents.id, evs.map((e) => e.id)));
  }
}
