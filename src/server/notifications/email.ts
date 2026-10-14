import "server-only";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notificationDeliveries, notifications, user, workspaceMembers, type NotificationDelivery } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import type { RenderedEmail } from "./templates";

/**
 * Email delivery through Resend's HTTP API (free tier), with a persistent log.
 *
 * Every message is a row in `notification_deliveries` before anything is sent,
 * keyed by a deterministic idempotency key that is also sent to Resend — so a
 * retry, a duplicate evaluation or two workers racing never send twice.
 * Transient failures (network, 429, 5xx) retry with backoff; permanent ones
 * (bad sender, invalid address) fail at once. When email isn't configured or
 * dry-run is on, rows are recorded as skipped with the reason, never as sent.
 */

export type EmailMode = "live" | "dry_run" | "not_configured";

export interface EmailStatus {
  mode: EmailMode;
  from: string;
  /** Why the mode isn't "live", in words a workspace admin can act on. */
  reason: string | null;
}

const PLACEHOLDER_SENDER = /@example\.(com|org|net)\b/i;

export function emailStatus(): EmailStatus {
  const from = env.EMAIL_FROM;
  if (env.EMAIL_DRY_RUN === "true" || env.NODE_ENV === "test") return { mode: "dry_run", from, reason: "Dry run is on (EMAIL_DRY_RUN): messages are recorded but not sent." };
  if (!env.RESEND_API_KEY) return { mode: "not_configured", from, reason: "No email provider is configured. Add a free Resend API key (RESEND_API_KEY) to send email." };
  if (PLACEHOLDER_SENDER.test(from)) return { mode: "not_configured", from, reason: "The sender is still the example address. Set EMAIL_FROM to an address on a domain verified in Resend." };
  return { mode: "live", from, reason: null };
}

/** Delay before attempt n+1 (attempts already made = n). */
export function backoffMs(attempts: number) {
  return [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000][Math.min(attempts - 1, 3)] ?? 2 * 3_600_000;
}

export interface QueueInput {
  workspaceId: string;
  userId: string | null;
  recipient: string;
  kind: "alert" | "test" | "digest" | "report" | "briefing";
  email: RenderedEmail;
  idempotencyKey: string;
  alertEventId?: string | null;
  briefingId?: string | null;
  isTest?: boolean;
  isSimulated?: boolean;
  /** Hold the first attempt until then (e.g. the end of quiet hours). */
  notBefore?: Date | null;
}

/** Record a message to send. Idempotent: the same key returns the existing row. */
export async function queueEmail(input: QueueInput): Promise<NotificationDelivery> {
  const [row] = await db
    .insert(notificationDeliveries)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      recipient: input.recipient,
      kind: input.kind,
      subject: input.email.subject,
      payload: { text: input.email.text, html: input.email.html },
      idempotencyKey: input.idempotencyKey,
      alertEventId: input.alertEventId ?? null,
      briefingId: input.briefingId ?? null,
      isTest: input.isTest ?? false,
      isSimulated: input.isSimulated ?? false,
      nextAttemptAt: input.notBefore ?? null,
    })
    .onConflictDoNothing({ target: notificationDeliveries.idempotencyKey })
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.idempotencyKey, input.idempotencyKey));
  return existing!;
}

export type SendOutcome = { ok: true; id: string | null } | { ok: false; retryable: boolean; error: string };
/** Injected in tests so nothing real is ever sent; production always uses Resend. */
export type Transport = (d: NotificationDelivery) => Promise<SendOutcome>;

async function sendViaResend(d: NotificationDelivery, fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": d.idempotencyKey.slice(0, 256) },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [d.recipient], subject: d.subject, text: d.payload.text, html: d.payload.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: j.id ?? null };
    }
    let message = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string; name?: string };
      if (j.message) message = `${message}: ${j.message}`.slice(0, 300);
    } catch {
      /* non-JSON error body */
    }
    return { ok: false, retryable: res.status === 429 || res.status >= 500, error: message };
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, retryable: true, error: timeout ? "Timed out reaching the email provider" : "Couldn't reach the email provider" };
  }
}

/**
 * Try to send one delivery now. Claims the row first (pending → sending), so
 * concurrent workers can't both send it. Returns the updated row.
 */
export async function attemptDelivery(id: string, opts: { transport?: Transport; now?: Date } = {}): Promise<NotificationDelivery | null> {
  const now = opts.now ?? new Date();
  const [claimed] = await db
    .update(notificationDeliveries)
    .set({ status: "sending", attempts: sql`${notificationDeliveries.attempts} + 1`, updatedAt: now })
    .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.status, "pending"), or(isNull(notificationDeliveries.nextAttemptAt), lte(notificationDeliveries.nextAttemptAt, now))))
    .returning();
  if (!claimed) return (await db.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, id)))[0] ?? null;

  const status = emailStatus();
  // Simulated data is only ever emailed as an explicit test.
  if (claimed.isSimulated && !claimed.isTest) return finish(claimed, { status: "skipped", lastError: "Simulated data is never emailed; it stays in-app." });
  if (!opts.transport && status.mode !== "live") return finish(claimed, { status: "skipped", lastError: status.reason });

  const out = opts.transport ? await opts.transport(claimed) : await sendViaResend(claimed);
  if (out.ok) return finish(claimed, { status: "sent", providerMessageId: out.id, sentAt: new Date(), lastError: null, nextAttemptAt: null });
  const final = !out.retryable || claimed.attempts >= claimed.maxAttempts;
  logger.warn({ delivery: claimed.id, attempts: claimed.attempts, final, retryable: out.retryable }, "email delivery failed");
  const row = await finish(claimed, final ? { status: "failed", lastError: out.error, nextAttemptAt: null } : { status: "pending", lastError: out.error, nextAttemptAt: new Date(now.getTime() + backoffMs(claimed.attempts)) });
  if (final) await fallbackInApp(claimed);
  return row;
}

async function finish(d: NotificationDelivery, patch: Partial<typeof notificationDeliveries.$inferInsert>) {
  const [row] = await db.update(notificationDeliveries).set({ ...patch, updatedAt: new Date() }).where(eq(notificationDeliveries.id, d.id)).returning();
  return row ?? null;
}

/** When email finally fails, say so in-app (the alert itself is already in the inbox). */
async function fallbackInApp(d: NotificationDelivery) {
  await db.insert(notifications).values({
    workspaceId: d.workspaceId,
    userId: d.userId,
    kind: "delivery_failed",
    title: `Email couldn't be delivered to ${d.recipient}`,
    body: `“${d.subject}” — shown here instead. Check Settings → Notifications for details.`,
    href: "/settings#notifications",
    alertEventId: d.alertEventId,
    isSimulated: d.isSimulated,
  });
}

/** Queue and attempt immediately; the worker retries anything left pending. */
export async function sendEmailNow(input: QueueInput, opts: { transport?: Transport } = {}) {
  const row = await queueEmail(input);
  if (row.status !== "pending" || (row.nextAttemptAt && row.nextAttemptAt > new Date())) return row;
  return (await attemptDelivery(row.id, opts)) ?? row;
}

/** Worker pass: retry due deliveries and recover rows stuck in "sending" by a crashed process. */
export async function processDueDeliveries(limit = 50, opts: { transport?: Transport; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  await db
    .update(notificationDeliveries)
    .set({ status: "pending" })
    .where(and(eq(notificationDeliveries.status, "sending"), lte(notificationDeliveries.updatedAt, new Date(now.getTime() - 10 * 60_000))));
  const due = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.status, "pending"), or(isNull(notificationDeliveries.nextAttemptAt), lte(notificationDeliveries.nextAttemptAt, now))))
    .orderBy(notificationDeliveries.createdAt)
    .limit(limit);
  let sent = 0;
  for (const d of due) if ((await attemptDelivery(d.id, opts))?.status === "sent") sent++;
  return { attempted: due.length, sent };
}

/** Workspace members who receive workspace email. */
export async function workspaceRecipients(workspaceId: string) {
  return db.select({ userId: user.id, email: user.email }).from(workspaceMembers).innerJoin(user, eq(user.id, workspaceMembers.userId)).where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function listDeliveries(workspaceId: string, limit = 25) {
  return db.select().from(notificationDeliveries).where(eq(notificationDeliveries.workspaceId, workspaceId)).orderBy(desc(notificationDeliveries.createdAt)).limit(limit);
}

/** Manual retry from Settings: put a failed or skipped row back in the queue and try now. */
export async function retryDelivery(workspaceId: string, id: string) {
  const [row] = await db
    .update(notificationDeliveries)
    .set({ status: "pending", nextAttemptAt: null, maxAttempts: sql`greatest(${notificationDeliveries.maxAttempts}, ${notificationDeliveries.attempts} + 1)` })
    .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.workspaceId, workspaceId), inArray(notificationDeliveries.status, ["failed", "skipped"])))
    .returning();
  if (!row) return null;
  return attemptDelivery(row.id);
}

/** The next time the clock reads `hhmm` in `timeZone` (for holding emails until quiet hours end). */
export function nextLocalTime(hhmm: string, timeZone: string, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
  let delta = h * 60 + m - nowMin;
  if (delta <= 0) delta += 24 * 60;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + delta * 60_000);
}
