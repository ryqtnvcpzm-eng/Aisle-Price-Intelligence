/**
 * Email delivery log: idempotency, retries with backoff, permanent failures,
 * concurrency and honest skips. A fake transport stands in for Resend, so no
 * real email is ever sent by the test suite.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deliverAlertEvent } from "@/server/alerts/deliver";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { attemptDelivery, backoffMs, emailStatus, nextLocalTime, processDueDeliveries, queueEmail, type SendOutcome, type Transport } from "@/server/notifications/email";
import { testEmail } from "@/server/notifications/templates";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { makeContext } from "../support/fixtures";

let ctx: AppContext;
const email = () => testEmail({ workspaceName: "Test", url: "http://localhost:3000", recipient: "x@test.local" });
let n = 0;
const key = () => `t:${Date.now()}:${++n}`;

function fakeTransport(outcomes: SendOutcome[], fallback: SendOutcome = { ok: true, id: "msg_default" }) {
  const calls: string[] = [];
  const ids: string[] = [];
  const t: Transport = async (d) => {
    calls.push(d.recipient);
    ids.push(d.id);
    return outcomes.shift() ?? fallback;
  };
  return { t, calls, callsFor: (id: string) => ids.filter((x) => x === id).length };
}

beforeAll(async () => {
  ctx = await makeContext("Mailer");
});
afterAll(async () => {
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

const base = () => ({ workspaceId: ctx.workspace.id, userId: ctx.user.id, recipient: ctx.user.email, kind: "test" as const, email: email(), isTest: true });

describe("email delivery", () => {
  it("never sends from the test suite without an injected transport", async () => {
    expect(emailStatus().mode).toBe("dry_run");
    const d = await queueEmail({ ...base(), idempotencyKey: key() });
    const r = await attemptDelivery(d.id);
    expect(r!.status).toBe("skipped");
    expect(r!.lastError).toMatch(/dry run/i);
  });

  it("is idempotent on its key", async () => {
    const k = key();
    const a = await queueEmail({ ...base(), idempotencyKey: k });
    const b = await queueEmail({ ...base(), idempotencyKey: k });
    expect(b.id).toBe(a.id);
    const rows = await db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.idempotencyKey, k));
    expect(rows).toHaveLength(1);
  });

  it("records a successful send with the provider's message id", async () => {
    const { t } = fakeTransport([{ ok: true, id: "msg_123" }]);
    const d = await queueEmail({ ...base(), idempotencyKey: key() });
    const r = await attemptDelivery(d.id, { transport: t });
    expect(r).toMatchObject({ status: "sent", providerMessageId: "msg_123", attempts: 1 });
    expect(r!.sentAt).not.toBeNull();
  });

  it("claims a row once even when two workers race", async () => {
    const { t, calls } = fakeTransport([{ ok: true, id: "a" }, { ok: true, id: "b" }]);
    const d = await queueEmail({ ...base(), idempotencyKey: key() });
    await Promise.all([attemptDelivery(d.id, { transport: t }), attemptDelivery(d.id, { transport: t })]);
    expect(calls).toHaveLength(1);
  });

  it("retries transient failures with backoff, then fails and falls back to in-app", async () => {
    const t0 = new Date();
    const { t, callsFor } = fakeTransport([], { ok: false, retryable: true, error: "HTTP 503" });
    const d = await queueEmail({ ...base(), idempotencyKey: key() });
    let r = await attemptDelivery(d.id, { transport: t, now: t0 });
    expect(r).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 503" });
    expect(r!.nextAttemptAt!.getTime()).toBe(t0.getTime() + backoffMs(1));
    // Not due yet: nothing happens.
    await processDueDeliveries(50, { transport: t, now: new Date(t0.getTime() + 1000) });
    expect(callsFor(d.id)).toBe(1);
    let clock = t0.getTime();
    for (let attempt = 2; attempt <= 4; attempt++) {
      clock += backoffMs(attempt - 1) + 1000;
      r = await attemptDelivery(d.id, { transport: t, now: new Date(clock) });
    }
    expect(callsFor(d.id)).toBe(4);
    expect(r).toMatchObject({ status: "failed", attempts: 4 });
    const fallback = await db.select().from(s.notifications).where(and(eq(s.notifications.workspaceId, ctx.workspace.id), eq(s.notifications.kind, "delivery_failed")));
    expect(fallback.length).toBeGreaterThanOrEqual(1);
  });

  it("fails permanently on a non-retryable error without retrying", async () => {
    const { t, callsFor } = fakeTransport([{ ok: false, retryable: false, error: "HTTP 422: invalid from address" }]);
    const d = await queueEmail({ ...base(), idempotencyKey: key() });
    const r = await attemptDelivery(d.id, { transport: t });
    expect(r).toMatchObject({ status: "failed", attempts: 1, lastError: "HTTP 422: invalid from address" });
    await processDueDeliveries(50, { transport: t, now: new Date(Date.now() + 86_400_000) });
    expect(callsFor(d.id)).toBe(1);
  });

  it("never emails simulated data unless it's an explicit test", async () => {
    const { t, calls } = fakeTransport([]);
    const d = await queueEmail({ ...base(), kind: "alert", isTest: false, isSimulated: true, idempotencyKey: key() });
    const r = await attemptDelivery(d.id, { transport: t });
    expect(r!.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("emails real alerts to members, holds them during quiet hours, and lists only delivered channels", async () => {
    const [rule] = await db
      .insert(s.alertRules)
      .values({ workspaceId: ctx.workspace.id, name: "Real drop", type: "pct_drop", params: { pct: 5 }, channels: ["in_app", "email"], quietHours: { start: "00:00", end: "23:59" } })
      .returning();
    const [ev1] = await db.insert(s.alertEvents).values({ ruleId: rule!.id, workspaceId: ctx.workspace.id, headline: "Rival fell 8%", detail: "₹1,000 → ₹920", dedupeKey: key(), isSimulated: false }).returning();
    const { t, calls } = fakeTransport([]);
    const quiet = await deliverAlertEvent(ev1!, rule!, { quiet: true, timeZone: "Asia/Kolkata", transport: t });
    expect(quiet).toEqual(["in_app"]); // held, not delivered yet
    expect(calls).toHaveLength(0);
    const [held] = await db.select().from(s.notificationDeliveries).where(eq(s.notificationDeliveries.alertEventId, ev1!.id));
    expect(held!.status).toBe("pending");
    expect(held!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    const [ev2] = await db.insert(s.alertEvents).values({ ruleId: rule!.id, workspaceId: ctx.workspace.id, headline: "Rival fell 9%", detail: null, dedupeKey: key(), isSimulated: false }).returning();
    const loud = await deliverAlertEvent(ev2!, rule!, { quiet: false, transport: t });
    expect(loud).toEqual(["in_app", "email"]);
    expect(calls).toEqual([ctx.user.email]);
    // Re-delivering the same event doesn't send twice (same idempotency key).
    await deliverAlertEvent(ev2!, rule!, { quiet: false, transport: t });
    expect(calls).toHaveLength(1);
  });
});

describe("quiet-hours clock", () => {
  it("finds the next local occurrence of a time", () => {
    const now = new Date("2026-10-12T20:00:00Z"); // 01:30 IST on the 13th
    expect(nextLocalTime("07:00", "Asia/Kolkata", now).toISOString()).toBe("2026-10-13T01:30:00.000Z");
    expect(nextLocalTime("01:00", "Asia/Kolkata", now).toISOString()).toBe("2026-10-13T19:30:00.000Z");
  });
});
