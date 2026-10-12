import "server-only";
import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { listings, providerQuotas, providerRequests } from "../db/schema";
import { env } from "../env";
import { monthKey } from "../providers";
import type { ProviderId } from "../providers/types";

export interface BudgetDecision {
  allowed: boolean;
  reason: string | null;
  retryAt: Date | null;
}

/**
 * Safeguard against runaway spend. A batch is refused when:
 *  - the provider told us to back off (pausedUntil), or
 *  - the configured monthly token budget would be exceeded, or
 *  - the last known token balance can't cover the batch.
 */
export async function checkBudget(provider: ProviderId, tokensNeeded: number, now = new Date()): Promise<BudgetDecision> {
  const [q] = await db.select().from(providerQuotas).where(eq(providerQuotas.provider, provider));
  if (!q) return { allowed: true, reason: null, retryAt: null };
  if (q.pausedUntil && q.pausedUntil > now) return { allowed: false, reason: "Provider asked us to wait for its allowance to refill.", retryAt: q.pausedUntil };
  const sameMonth = q.monthKey === monthKey(now);
  const used = sameMonth ? q.tokensUsedMonth : 0;
  const budget = q.budgetTokensMonth ?? (provider === "keepa" ? (env.KEEPA_MONTHLY_TOKEN_BUDGET ?? null) : null);
  if (budget !== null && used + tokensNeeded > budget) {
    return { allowed: false, reason: `Monthly budget of ${budget.toLocaleString()} tokens reached (${used.toLocaleString()} used).`, retryAt: null };
  }
  if (provider !== "demo" && q.tokensLeft !== null && q.tokensLeft < tokensNeeded) {
    const refillMs = q.refillInMs ?? 60_000;
    return { allowed: false, reason: `Only ${q.tokensLeft} provider tokens left.`, retryAt: new Date(now.getTime() + refillMs) };
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
  estimatedMonthlyCostUsd: number | null;
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
  // Keepa charges ~1 token per product (+2 with Buy Box data); demo mirrors that.
  const tokensPerItem = provider === "keepa" ? 3 : 1;
  const tokensPerDay = Math.round(perDay * tokensPerItem);
  const sameMonth = q?.monthKey === monthKey();
  return {
    monitoredListings: Number(mon?.n ?? 0),
    requestsPerDay: Math.round(perDay),
    tokensPerDayEstimate: tokensPerDay,
    tokensUsedMonth: sameMonth ? (q?.tokensUsedMonth ?? 0) : 0,
    requestsMonth: sameMonth ? (q?.requestsMonth ?? 0) : 0,
    budgetTokensMonth: q?.budgetTokensMonth ?? env.KEEPA_MONTHLY_TOKEN_BUDGET ?? null,
    projectedMonthTokens: tokensPerDay * 30,
    estimatedMonthlyCostUsd: provider === "keepa" && env.KEEPA_TOKEN_COST_USD !== undefined ? Math.round(tokensPerDay * 30 * env.KEEPA_TOKEN_COST_USD * 100) / 100 : provider === "demo" ? 0 : null,
    tokensLeft: q?.tokensLeft ?? null,
    pausedUntil: q?.pausedUntil ?? null,
    failures24h: Number(req?.failed ?? 0),
    requests24h: Number(req?.total ?? 0),
  };
}
