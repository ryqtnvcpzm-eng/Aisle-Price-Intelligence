import "server-only";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { alertEvents, notifications, workspaces, type AlertRule } from "../db/schema";
import { env } from "../env";
import { emailStatus, nextLocalTime, sendEmailNow, workspaceRecipients, type Transport } from "../notifications/email";
import { alertEmail, digestEmail } from "../notifications/templates";

type AlertEvent = typeof alertEvents.$inferSelect;

/**
 * Deliver an alert event:
 *  - always: an in-app notification (labelled simulated where applicable)
 *  - email: real (non-simulated) data only, instant-frequency rules that opt in.
 *    During quiet hours the email is held until they end ("events still record;
 *    emails wait"). Test notifications are the one explicit exception for
 *    simulated data, and go only to the person who asked for the test.
 * `deliveredChannels` lists only channels that actually delivered; per-recipient
 * detail (pending, retried, failed, skipped and why) lives in the delivery log.
 */
export async function deliverAlertEvent(ev: AlertEvent, rule: AlertRule, opts: { quiet: boolean; timeZone?: string; testRecipient?: { userId: string; email: string }; transport?: Transport }) {
  const channels: string[] = [];
  await db.insert(notifications).values({
    workspaceId: ev.workspaceId,
    kind: ev.isTest ? "test" : "alert",
    title: ev.headline,
    body: ev.detail,
    href: `/alerts?event=${ev.id}`,
    alertEventId: ev.id,
    isSimulated: ev.isSimulated,
  });
  channels.push("in_app");

  const wantsEmail = rule.channels.includes("email") && (rule.frequency === "instant" || ev.isTest);
  const emailAllowed = ev.isTest || !ev.isSimulated;
  if (wantsEmail && emailAllowed) {
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ev.workspaceId));
    const recipients = ev.isTest && opts.testRecipient ? [opts.testRecipient] : await workspaceRecipients(ev.workspaceId);
    const notBefore = opts.quiet && rule.quietHours && !ev.isTest ? nextLocalTime(rule.quietHours.end, opts.timeZone ?? "UTC") : null;
    const email = alertEmail({ headline: ev.headline, detail: ev.detail, ruleName: rule.name, workspaceName: ws?.name ?? "Aisle", url: `${env.BETTER_AUTH_URL}/alerts?event=${ev.id}`, simulated: ev.isSimulated, test: ev.isTest });
    let sent = 0;
    for (const r of recipients) {
      const d = await sendEmailNow({ workspaceId: ev.workspaceId, userId: r.userId, recipient: r.email, kind: ev.isTest ? "test" : "alert", email, idempotencyKey: `alert:${ev.id}:${r.userId}`, alertEventId: ev.id, isTest: ev.isTest, isSimulated: ev.isSimulated, notBefore }, { transport: opts.transport });
      if (d.status === "sent") sent++;
    }
    if (sent) channels.push("email");
  }
  await db.update(alertEvents).set({ deliveredChannels: channels }).where(eq(alertEvents.id, ev.id));
  return channels;
}

/** Daily/weekly digest of undigested events per workspace (real data only, digest-frequency rules). */
export async function sendDigests(frequency: "daily" | "weekly", now = new Date()) {
  if (emailStatus().mode === "not_configured") return { workspaces: 0 };
  const since = new Date(now.getTime() - (frequency === "daily" ? 1 : 7) * 86_400_000);
  const events = await db
    .select()
    .from(alertEvents)
    .where(and(isNull(alertEvents.digestSentAt), gte(alertEvents.firedAt, since), eq(alertEvents.isSimulated, false), eq(alertEvents.isTest, false)));
  const byWs = new Map<string, AlertEvent[]>();
  for (const e of events) byWs.set(e.workspaceId, [...(byWs.get(e.workspaceId) ?? []), e]);
  const day = now.toISOString().slice(0, 10);
  for (const [ws, evs] of byWs) {
    const email = digestEmail({ frequency, items: evs.map((e) => ({ headline: e.headline, detail: e.detail })), url: `${env.BETTER_AUTH_URL}/alerts` });
    for (const r of await workspaceRecipients(ws)) {
      await sendEmailNow({ workspaceId: ws, userId: r.userId, recipient: r.email, kind: "digest", email, idempotencyKey: `digest:${frequency}:${ws}:${day}:${r.userId}` });
    }
    await db.update(alertEvents).set({ digestSentAt: now }).where(inArray(alertEvents.id, evs.map((e) => e.id)));
  }
  return { workspaces: byWs.size };
}
