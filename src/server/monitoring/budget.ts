import "server-only";
import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { listings, providerQuotas, providerRequests } from "../db/schema";
import { monthKey } from "../providers";
import type { ProviderId } from "../providers/types";

export interface BudgetDecision {
  allowed: boolean;
  reason: string | null;
  retryAt: Date | null;
}

/**
 * Safeguard against exhausting a provider's free allowance. A batch is refused when:
 *  - the provider told us to back off (pausedUntil), or
 *  - a stored monthly cap would be exceeded, or
 *  - the last known allowance can't cover the batch.
 */
export async function checkBudget(provider: ProviderId, tokensNeeded: number, now = new Date()): Promise<BudgetDecision> {
  const [q] = await db.select().from(providerQuotas).where(eq(providerQuotas.provider, provider));
  if (!q) return { allowed: true, reason: null, retryAt: null };
  if (q.pausedUntil && q.pausedUntil > now) return { allowed: false, reason: "Provider asked us to wait for its allowance to refill.", retryAt: q.pausedUntil };
  const sameMonth = q.monthKey === monthKey(now);
  const used = sameMonth ? q.tokensUsedMonth : 0;
  const budget = q.budgetTokensMonth;
  if (budget !== null && used + tokensNeeded > budget) {
    return { allowed: false, reason: `Monthly cap of ${budget.toLocaleString()} requests reached (${used.toLocaleString()} used).`, retryAt: null };
  }
  if (provider !== "demo" && q.tokensLeft !== null && q.tokensLeft < tokensNeeded) {
    const refillMs = q.refillInMs ?? 60_000;
    return { allowed: false, reason: `Only ${q.tokensLeft} provider requests left in this window.`, retryAt: new Date(now.getTime() + refillMs) };
  }
  return { allowed: true, reason: null, retryAt: null };
}

export async function pauseProvider(provider: ProviderId, until: Date) {
  await db
    .insert(providerQuotas)
    .values({ provider, monthKey: monthKey(), pausedUntil: until })
    .onConflictDoUpdate({ target: providerQuotas.provider, set: { pausedUntil: until } });
}

export interface BudgetSummary {
  monitoredListings: number;
  requestsPerDay: number;
  tokensPerDayEstimate: number;
  tokensUsedMonth: number;
  requestsMonth: number;
  budgetTokensMonth: number | null;
  projectedMonthTokens: number;
  tokensLeft: number | null;
  pausedUntil: Date | null;
  failures24h: number;
  requests24h: number;
}

export async function budgetSummary(provider: ProviderId): Promise<BudgetSummary> {
  const [mon] = await db
    .select({
      n: count(),
      perDay: sql<number>`coalesce(sum(1440.0 / ${listings.checkIntervalMinutes}), 0)`,
    })
    .from(listings)
    .where(and(isNotNull(listings.checkIntervalMinutes), eq(listings.provider, provider)));
  const [q] = await db.select().from(providerQuotas).where(eq(providerQuotas.provider, provider));
  const since = new Date(Date.now() - 86_400_000);
  const [req] = await db
    .select({ total: count(), failed: sql<number>`count(*) filter (where ${providerRequests.status} <> 'ok')` })
    .from(providerRequests)
    .where(and(eq(providerRequests.provider, provider), gte(providerRequests.createdAt, since)));
  const perDay = Number(mon?.perDay ?? 0);
  // One request unit per item checked.
  const tokensPerDay = Math.round(perDay);
  const sameMonth = q?.monthKey === monthKey();
  return {
    monitoredListings: Number(mon?.n ?? 0),
    requestsPerDay: Math.round(perDay),
    tokensPerDayEstimate: tokensPerDay,
    tokensUsedMonth: sameMonth ? (q?.tokensUsedMonth ?? 0) : 0,
    requestsMonth: sameMonth ? (q?.requestsMonth ?? 0) : 0,
    budgetTokensMonth: q?.budgetTokensMonth ?? null,
    projectedMonthTokens: tokensPerDay * 30,
    tokensLeft: q?.tokensLeft ?? null,
    pausedUntil: q?.pausedUntil ?? null,
    failures24h: Number(req?.failed ?? 0),
    requests24h: Number(req?.total ?? 0),
  };
}
