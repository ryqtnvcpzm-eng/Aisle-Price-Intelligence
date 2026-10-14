import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { compare, type ComparisonInput } from "@/lib/comparison";
import { formatMoney, formatPct } from "@/lib/money";
import { isNormalizationBasis, NORMALIZATION_BASES } from "@/lib/quantity";
import { db } from "../db/client";
import {
  alertEvents,
  alertRules,
  brands,
  comparisonGroups,
  comparisonItems,
  listings,
  priceObservations,
  productFamilies,
  providerQuotas,
  variantQuantities,
  variants,
  workspaces,
  type AlertRule,
} from "../db/schema";
import { logger } from "../logger";
import { deliverAlertEvent } from "./deliver";

export interface AlertCandidate {
  rule: AlertRule;
  variantId: string | null;
  headline: string;
  detail: string;
  metrics: Record<string, unknown>;
  dedupeKey: string;
  isSimulated: boolean;
}

export interface VariantState {
  variantId: string;
  workspaceId: string;
  listingId: string;
  brandId: string | null;
  name: string;
  currency: string | null;
  price: number | null;
  prevPrice: number | null;
  prevDistinctPrice: number | null;
  availability: string;
  prevAvailability: string | null;
  /** Provenance of the previous observation, so simulated and verified prices are never compared. */
  prevIsSimulated: boolean | null;
  prevCurrency: string | null;
  /** Provenance of the latest observation (the listing flag says what the listing is, not what this reading was). */
  curIsSimulated: boolean | null;
  price24h: number | null;
  observedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  isSimulated: boolean;
}

async function loadVariantStates(where: { listingIds?: string[]; variantIds?: string[] }): Promise<VariantState[]> {
  const rows = await db
    .select({
      variantId: variants.id,
      workspaceId: variants.workspaceId,
      listingId: variants.listingId,
      brandId: productFamilies.brandId,
      label: variants.label,
      familyTitle: productFamilies.title,
      currency: listings.currency,
      price: listings.currentPriceMinor,
      availability: listings.availability,
      observedAt: listings.lastObservedAt,
      lastSuccessAt: listings.lastSuccessAt,
      lastFailureAt: listings.lastFailureAt,
      consecutiveFailures: listings.consecutiveFailures,
      isSimulated: listings.isSimulated,
    })
    .from(variants)
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .where(
      and(
        eq(variants.tracked, true),
        where.listingIds ? inArray(variants.listingId, where.listingIds) : undefined,
        where.variantIds ? inArray(variants.id, where.variantIds) : undefined,
      ),
    );
  if (!rows.length) return [];
  const listingIds = [...new Set(rows.map((r) => r.listingId))];
  // Previous observation and previous *different* price per listing.
  const prev = await db.execute<{ listing_id: string; price_minor: number | null; availability: string; is_simulated: boolean; currency: string; rn: number }>(sql`
    select listing_id, price_minor, availability, is_simulated, currency, rn from (
      select listing_id, price_minor, availability, is_simulated, currency, row_number() over (partition by listing_id order by observed_at desc) rn
      from price_observations where listing_id in ${listingIds}
    ) x where rn <= 2`);
  const prevDistinct = await db.execute<{ listing_id: string; price_minor: number }>(sql`
    select distinct on (o.listing_id) o.listing_id, o.price_minor
    from price_observations o join listings l on l.id = o.listing_id
    where o.listing_id in ${listingIds} and o.price_minor is not null and o.price_minor is distinct from l.current_price_minor and o.observed_at < l.last_observed_at
    order by o.listing_id, o.observed_at desc`);
  const ago = await db.execute<{ listing_id: string; price_minor: number | null }>(sql`
    select distinct on (listing_id) listing_id, price_minor from price_observations
    where listing_id in ${listingIds} and observed_at <= now() - interval '24 hours' and observed_at >= now() - interval '48 hours'
    order by listing_id, observed_at desc`);
  const agoMap = new Map(ago.map((a) => [a.listing_id, a.price_minor]));
  const prevMap = new Map(prev.filter((p) => Number(p.rn) === 2).map((p) => [p.listing_id, p]));
  const curMap = new Map(prev.filter((p) => Number(p.rn) === 1).map((p) => [p.listing_id, p]));
  const distinctMap = new Map(prevDistinct.map((p) => [p.listing_id, p.price_minor]));
  return rows.map((r) => ({
    variantId: r.variantId,
    workspaceId: r.workspaceId,
    listingId: r.listingId,
    brandId: r.brandId,
    name: `${r.familyTitle.split(",")[0]} · ${r.label}`,
    currency: r.currency,
    price: r.price,
    prevPrice: prevMap.get(r.listingId)?.price_minor ?? null,
    prevDistinctPrice: distinctMap.get(r.listingId) ?? null,
    availability: r.availability,
    prevAvailability: prevMap.get(r.listingId)?.availability ?? null,
    prevIsSimulated: prevMap.get(r.listingId)?.is_simulated ?? null,
    prevCurrency: prevMap.get(r.listingId)?.currency ?? null,
    curIsSimulated: curMap.get(r.listingId)?.is_simulated ?? null,
    price24h: agoMap.get(r.listingId) ?? null,
    observedAt: r.observedAt,
    lastSuccessAt: r.lastSuccessAt,
    lastFailureAt: r.lastFailureAt,
    consecutiveFailures: r.consecutiveFailures,
    isSimulated: r.isSimulated,
  }));
}

const money = (v: VariantState, m: number | null) => formatMoney(m, v.currency ?? "INR");
const obsKey = (v: VariantState) => v.observedAt?.toISOString() ?? "none";

/** Evaluate a single-variant rule against current + previous state. Fires on transitions only. */
function evaluateVariantRule(rule: AlertRule, v: VariantState): AlertCandidate | null {
  const p = rule.params;
  const base = { rule, variantId: v.variantId, isSimulated: v.isSimulated };
  switch (rule.type) {
    case "price_below":
      if (p.thresholdMinor == null || v.price === null) return null;
      if (v.price <= p.thresholdMinor && (v.prevPrice === null || v.prevPrice > p.thresholdMinor)) {
        return { ...base, headline: `${v.name} dropped to ${money(v, v.price)}`, detail: `Below your ${money(v, p.thresholdMinor)} threshold.`, metrics: { price: v.price, threshold: p.thresholdMinor, previous: v.prevPrice }, dedupeKey: `below:${v.variantId}:${obsKey(v)}` };
      }
      return null;
    case "price_above":
      if (p.thresholdMinor == null || v.price === null) return null;
      if (v.price >= p.thresholdMinor && (v.prevPrice === null || v.prevPrice < p.thresholdMinor)) {
        return { ...base, headline: `${v.name} rose to ${money(v, v.price)}`, detail: `Above your ${money(v, p.thresholdMinor)} threshold.`, metrics: { price: v.price, threshold: p.thresholdMinor, previous: v.prevPrice }, dedupeKey: `above:${v.variantId}:${obsKey(v)}` };
      }
      return null;
    case "pct_drop":
    case "pct_rise": {
      if (v.price === null || v.prevPrice === null || v.prevPrice === v.price || p.pct == null) return null;
      const r = (v.price - v.prevPrice) / v.prevPrice;
      const hit = rule.type === "pct_drop" ? r <= -p.pct / 100 : r >= p.pct / 100;
      if (!hit) return null;
      return { ...base, headline: `${v.name} ${r < 0 ? "fell" : "rose"} ${formatPct(Math.abs(r))}`, detail: `${money(v, v.prevPrice)} → ${money(v, v.price)}`, metrics: { from: v.prevPrice, to: v.price, ratio: r }, dedupeKey: `${rule.type}:${v.variantId}:${obsKey(v)}` };
    }
    case "daily_move": {
      if (v.price === null || v.price24h === null || p.pct == null) return null;
      const r = (v.price - v.price24h) / v.price24h;
      if (Math.abs(r) < p.pct / 100) return null;
      return { ...base, headline: `${v.name} moved ${formatPct(r, { signed: true })} in 24h`, detail: `${money(v, v.price24h)} → ${money(v, v.price)}`, metrics: { from: v.price24h, to: v.price, ratio: r }, dedupeKey: `daily:${v.variantId}:${new Date().toISOString().slice(0, 10)}` };
    }
    case "out_of_stock":
      if (v.availability === "out_of_stock" && v.prevAvailability && v.prevAvailability !== "out_of_stock") {
        return { ...base, headline: `${v.name} is unavailable`, detail: `Last seen at ${money(v, v.prevPrice)}.`, metrics: { previous: v.prevPrice }, dedupeKey: `oos:${v.variantId}:${obsKey(v)}` };
      }
      return null;
    case "back_in_stock":
      if (v.availability === "in_stock" && v.prevAvailability === "out_of_stock") {
        return { ...base, headline: `${v.name} is back in stock`, detail: `Now ${money(v, v.price)}.`, metrics: { price: v.price }, dedupeKey: `bis:${v.variantId}:${obsKey(v)}` };
      }
      return null;
    case "stale_data": {
      const hours = p.hours ?? 6;
      if (!v.lastSuccessAt || Date.now() - v.lastSuccessAt.getTime() < hours * 3_600_000) return null;
      return { ...base, headline: `${v.name} hasn't refreshed in ${hours}h+`, detail: `Last successful check ${v.lastSuccessAt.toISOString()}.`, metrics: { lastSuccessAt: v.lastSuccessAt.toISOString() }, dedupeKey: `stale:${v.variantId}:${v.lastSuccessAt.toISOString()}`, isSimulated: false };
    }
    case "monitoring_failures": {
      const n = p.failures ?? 3;
      if (v.consecutiveFailures < n || !v.lastFailureAt) return null;
      return { ...base, headline: `${v.name} failed ${v.consecutiveFailures} checks in a row`, detail: "Aisle keeps retrying with backoff.", metrics: { failures: v.consecutiveFailures }, dedupeKey: `fail:${v.variantId}:${v.lastSuccessAt?.toISOString() ?? "never"}`, isSimulated: false };
    }
    default:
      return null;
  }
}

const KNOWN_AVAILABLE = new Set(["in_stock", "limited", "preorder"]);

/**
 * Protect My Brand rules evaluated per listing inside a managed comparison.
 * Both compare two *consecutive observations* of the same listing: nothing is
 * interpolated, unknown availability never counts as out of stock, and a
 * simulated observation is never compared with a verified one.
 */
export function evaluateProtectionVariantRule(rule: Pick<AlertRule, "type" | "params">, v: VariantState, referenceBrandId: string | null): Omit<AlertCandidate, "rule"> | null {
  if (!referenceBrandId) return null;
  const isReference = v.brandId === referenceBrandId;
  const base = { variantId: v.variantId, isSimulated: v.isSimulated };
  switch (rule.type) {
    case "reference_out_of_stock":
      if (!isReference || v.availability !== "out_of_stock" || !v.prevAvailability || !KNOWN_AVAILABLE.has(v.prevAvailability)) return null;
      return { ...base, headline: `${v.name} is out of stock`, detail: `Your listing was ${v.prevAvailability.replace("_", " ")} at the previous check${v.prevPrice !== null ? ` (${money(v, v.prevPrice)})` : ""}.`, metrics: { previousAvailability: v.prevAvailability, previous: v.prevPrice }, dedupeKey: `ref_oos:${v.variantId}:${obsKey(v)}` };
    case "rival_drop_5pct": {
      const pct = rule.params.pct ?? 5;
      if (isReference || v.price === null || v.prevPrice === null || v.prevPrice <= 0) return null;
      if (v.prevIsSimulated === null || v.curIsSimulated === null || v.prevIsSimulated !== v.curIsSimulated) return null;
      if (v.prevCurrency && v.currency && v.prevCurrency !== v.currency) return null;
      const r = (v.price - v.prevPrice) / v.prevPrice;
      if (r > -pct / 100) return null;
      return { ...base, headline: `${v.name} dropped ${formatPct(Math.abs(r))}`, detail: `${money(v, v.prevPrice)} → ${money(v, v.price)} between two consecutive checks.`, metrics: { from: v.prevPrice, to: v.price, ratio: r }, dedupeKey: `rival_drop:${v.variantId}:${obsKey(v)}` };
    }
    default:
      return null;
  }
}

async function historicalLow(rule: AlertRule, v: VariantState): Promise<AlertCandidate | null> {
  if (v.price === null) return null;
  const days = rule.params.windowDays ?? 90;
  const [row] = await db
    .select({ min: sql<number | null>`min(${priceObservations.priceMinor})` })
    .from(priceObservations)
    .where(and(eq(priceObservations.listingId, v.listingId), gte(priceObservations.observedAt, new Date(Date.now() - days * 86_400_000)), lt(priceObservations.observedAt, v.observedAt ?? new Date())));
  if (row?.min == null || v.price >= row.min) return null;
  return {
    rule,
    variantId: v.variantId,
    isSimulated: v.isSimulated,
    headline: `${v.name} hit an observed ${days}-day low`,
    detail: `${money(v, v.price)}, below the previous low of ${money(v, row.min)} in Aisle's observations.`,
    metrics: { price: v.price, previousLow: row.min, windowDays: days },
    dedupeKey: `low:${v.variantId}:${v.price}`,
  };
}

/** Group rules recompute the comparison and fire on changes in ranking/undercutting. */
async function evaluateGroupRule(rule: AlertRule): Promise<AlertCandidate | null> {
  if (!rule.groupId) return null;
  const [group] = await db.select().from(comparisonGroups).where(eq(comparisonGroups.id, rule.groupId));
  if (!group || group.archivedAt) return null;
  const items = await db
    .select({ id: variants.id, role: comparisonItems.role, status: comparisonItems.status, label: variants.label, title: productFamilies.title, brand: brands.name, isRef: brands.isReference, price: listings.currentPriceMinor, currency: listings.currency, availability: listings.availability, sim: listings.isSimulated, refBrandId: comparisonGroups.referenceBrandId, brandId: productFamilies.brandId })
    .from(comparisonItems)
    .innerJoin(variants, eq(variants.id, comparisonItems.variantId))
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .innerJoin(comparisonGroups, eq(comparisonGroups.id, comparisonItems.groupId))
    .leftJoin(brands, eq(brands.id, productFamilies.brandId))
    .where(eq(comparisonItems.groupId, group.id));
  if (items.length < 2) return null;
  const qs = await db.select().from(variantQuantities).where(inArray(variantQuantities.variantId, items.map((i) => i.id)));
  const input: ComparisonInput[] = items.map((i) => ({
    id: i.id,
    brandName: i.brand,
    label: i.label,
    productTitle: i.title,
    role: i.role === "reference" || (group.referenceBrandId ? i.brandId === group.referenceBrandId : Boolean(i.isRef)) ? "reference" : "competitor",
    status: i.status,
    priceMinor: i.price,
    currency: i.currency,
    availability: i.availability,
    quantities: qs.filter((q) => q.variantId === i.id).map((q) => ({ dimension: q.dimension, totalMilli: q.totalMilli, packCount: q.packCount })),
  }));
  const res = compare(input, isNormalizationBasis(group.basis) ? group.basis : "per_100g");
  const sim = items.some((i) => i.sim);
  const base = { rule, variantId: null, isSimulated: sim };
  const state = (rule.params as { state?: Record<string, string> }).state ?? {};
  switch (rule.type) {
    case "competitor_undercut": {
      if (!res.undercutters.length || !res.referenceBest) return null;
      const sig = res.undercutters.map((u) => `${u.id}@${u.unitPriceMinor}`).sort().join(",");
      const u = res.undercutters[0]!;
      return { ...base, variantId: u.id, headline: `${u.brandName ?? "A competitor"} undercuts ${res.referenceBest.brandName ?? "your reference"} in ${group.name}`, detail: `${res.undercutters.length} competitor listing(s) priced below your best unit price.`, metrics: { undercutters: res.undercutters.length, best: u.unitPriceMinor, reference: res.referenceBest.unitPriceMinor }, dedupeKey: `undercut:${group.id}:${sig}` };
    }
    case "gap_exceeds": {
      const ref = res.referenceBest;
      const limit = (rule.params.gapPct ?? 15) / 100;
      if (!ref || ref.premium === null || Math.abs(ref.premium) < limit) return null;
      return { ...base, variantId: ref.id, headline: `${group.name}: price gap now ${formatPct(ref.premium, { signed: true })} vs competitor median`, detail: `Your threshold is ±${formatPct(limit)}.`, metrics: { premium: ref.premium }, dedupeKey: `gap:${group.id}:${new Date().toISOString().slice(0, 10)}` };
    }
    case "leader_change": {
      const leader = res.cheapest;
      if (!leader) return null;
      const previous = state.leaderId;
      await db.update(alertRules).set({ params: { ...rule.params, state: { ...state, leaderId: leader.id } } as AlertRule["params"] }).where(eq(alertRules.id, rule.id));
      if (!previous || previous === leader.id) return null;
      return { ...base, variantId: leader.id, headline: `New price leader in ${group.name}: ${leader.brandName ?? ""} ${leader.label}`.trim(), detail: `Lowest unit price is now ${formatMoney(leader.unitPriceMinor, res.currency ?? "INR")}.`, metrics: { leader: leader.id, previous }, dedupeKey: `leader:${group.id}:${leader.id}:${previous}` };
    }
    case "price_leadership_change": {
      const leader = res.cheapest;
      if (!leader) return null;
      // Leadership is held by a brand, not a pack size: switching between two of the same brand's listings isn't news.
      const leaderKey = leader.role === "reference" ? "reference" : `brand:${leader.brandName ?? "unbranded"}`;
      const previous = (rule.state as { leaderKey?: string }).leaderKey;
      await db.update(alertRules).set({ state: { ...rule.state, leaderKey, leaderId: leader.id } }).where(eq(alertRules.id, rule.id));
      if (!previous || previous === leaderKey) return null;
      const who = leader.role === "reference" ? `${leader.brandName ?? "Your brand"} (your brand)` : (leader.brandName ?? "An unbranded listing");
      const headline = leader.role === "reference" ? `${who} now has the lowest unit price in ${group.name}` : previous === "reference" ? `${who} took the lowest unit price from you in ${group.name}` : `${who} now has the lowest unit price in ${group.name}`;
      return { ...base, variantId: null, headline, detail: `${leader.label} at ${formatMoney(leader.unitPriceMinor, res.currency ?? "INR")}${NORMALIZATION_BASES[res.basis].label}.`, metrics: { leader: leader.id, leaderKey, previous }, dedupeKey: `leadership:${group.id}:${previous}->${leaderKey}:${obsSignature(items)}` };
    }
    case "historical_low":
      return null;
    default:
      return null;
  }
}

/** Identifies the set of observations a group evaluation saw, so one change fires one event. */
function obsSignature(items: { id: string; price: number | null }[]) {
  const sig = items.map((i) => `${i.id}=${i.price ?? "-"}`).sort().join(",");
  return createHash("sha1").update(sig).digest("hex").slice(0, 16);
}

function inQuietHours(rule: AlertRule, timeZone: string, now = new Date()): boolean {
  const qh = rule.quietHours;
  if (!qh) return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const cur = parts.replace(":", "");
  const s = qh.start.replace(":", "");
  const e = qh.end.replace(":", "");
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

async function persistCandidate(c: AlertCandidate, timeZone: string) {
  const now = new Date();
  // Cooldown is per rule *and* subject, so one noisy listing doesn't mute the rest of a group.
  const [last] = await db
    .select({ firedAt: alertEvents.firedAt })
    .from(alertEvents)
    .where(and(eq(alertEvents.ruleId, c.rule.id), c.variantId ? eq(alertEvents.variantId, c.variantId) : isNull(alertEvents.variantId), eq(alertEvents.isTest, false)))
    .orderBy(desc(alertEvents.firedAt))
    .limit(1);
  if (last && now.getTime() - last.firedAt.getTime() < c.rule.cooldownMinutes * 60_000) return null;
  const [ev] = await db
    .insert(alertEvents)
    .values({ ruleId: c.rule.id, workspaceId: c.rule.workspaceId, variantId: c.variantId, headline: c.headline, detail: c.detail, metrics: c.metrics, dedupeKey: c.dedupeKey, isSimulated: c.isSimulated })
    .onConflictDoNothing()
    .returning();
  if (!ev) return null;
  await db.update(alertRules).set({ lastTriggeredAt: now }).where(eq(alertRules.id, c.rule.id));
  c.rule.lastTriggeredAt = now;
  await deliverAlertEvent(ev, c.rule, { quiet: inQuietHours(c.rule, timeZone, now), timeZone });
  return ev;
}

/** Evaluate every active rule touching these listings (variant rules, group rules, workspace rules). */
export async function evaluateAlertsForListings(listingIds: string[], _ctx: { trigger: "refresh" | "failure" | "manual" }) {
  const states = await loadVariantStates({ listingIds });
  if (!states.length) return { fired: 0 };
  const workspaceIds = [...new Set(states.map((s) => s.workspaceId))];
  const variantIds = states.map((s) => s.variantId);
  const groupRows = await db.select({ groupId: comparisonItems.groupId }).from(comparisonItems).where(inArray(comparisonItems.variantId, variantIds));
  const groupIds = [...new Set(groupRows.map((g) => g.groupId))];
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        inArray(alertRules.workspaceId, workspaceIds),
        eq(alertRules.paused, false),
        or(inArray(alertRules.variantId, variantIds), groupIds.length ? inArray(alertRules.groupId, groupIds) : sql`false`, and(isNull(alertRules.variantId), isNull(alertRules.groupId))),
      ),
    );
  const tz = new Map((await db.select({ id: workspaces.id, tz: workspaces.timeZone }).from(workspaces).where(inArray(workspaces.id, workspaceIds))).map((w) => [w.id, w.tz]));
  let fired = 0;
  for (const rule of rules) {
    try {
      const candidates: AlertCandidate[] = [];
      if (rule.groupId && ["competitor_undercut", "gap_exceeds", "leader_change", "price_leadership_change"].includes(rule.type)) {
        const c = await evaluateGroupRule(rule);
        if (c) candidates.push(c);
      } else if (rule.groupId && (rule.type === "reference_out_of_stock" || rule.type === "rival_drop_5pct")) {
        const [g] = await db.select({ refBrandId: comparisonGroups.referenceBrandId, archivedAt: comparisonGroups.archivedAt }).from(comparisonGroups).where(eq(comparisonGroups.id, rule.groupId));
        if (g && !g.archivedAt) {
          const refBrandId = g.refBrandId ?? (await db.select({ id: brands.id }).from(brands).where(and(eq(brands.workspaceId, rule.workspaceId), eq(brands.isReference, true))))[0]?.id ?? null;
          const members = new Set((await db.select({ variantId: comparisonItems.variantId }).from(comparisonItems).where(and(eq(comparisonItems.groupId, rule.groupId), eq(comparisonItems.status, "confirmed")))).map((m) => m.variantId));
          for (const s of states.filter((x) => members.has(x.variantId))) {
            const c = evaluateProtectionVariantRule(rule, s, refBrandId);
            if (c) candidates.push({ ...c, rule });
          }
        }
      } else if (rule.groupId) {
        // Variant-type rule applied to every member of a group.
        const members = await db.select({ variantId: comparisonItems.variantId }).from(comparisonItems).where(eq(comparisonItems.groupId, rule.groupId));
        for (const s of states.filter((x) => members.some((m) => m.variantId === x.variantId))) {
          const c = rule.type === "historical_low" ? await historicalLow(rule, s) : evaluateVariantRule(rule, s);
          if (c) candidates.push(c);
        }
      } else {
        const scope = rule.variantId ? states.filter((s) => s.variantId === rule.variantId) : states.filter((s) => s.workspaceId === rule.workspaceId);
        for (const s of scope) {
          const c = rule.type === "historical_low" ? await historicalLow(rule, s) : evaluateVariantRule(rule, s);
          if (c) candidates.push(c);
        }
      }
      for (const c of candidates) if (await persistCandidate(c, tz.get(rule.workspaceId) ?? "UTC")) fired++;
      await db.update(alertRules).set({ lastEvaluatedAt: new Date() }).where(eq(alertRules.id, rule.id));
    } catch (e) {
      logger.error({ err: e, rule: rule.id }, "rule evaluation failed");
    }
  }
  return { fired };
}

/** Workspace-level system checks: provider quota exhaustion. */
export async function evaluateSystemAlerts() {
  const paused = await db.select().from(providerQuotas).where(gte(providerQuotas.pausedUntil, new Date()));
  if (!paused.length) return;
  const rules = await db.select().from(alertRules).where(and(eq(alertRules.type, "quota_exhausted"), eq(alertRules.paused, false)));
  for (const rule of rules) {
    for (const q of paused) {
      await persistCandidate(
        { rule, variantId: null, headline: `${q.provider} allowance exhausted`, detail: `Refreshes resume around ${q.pausedUntil!.toISOString()}.`, metrics: { provider: q.provider, until: q.pausedUntil!.toISOString() }, dedupeKey: `quota:${q.provider}:${q.pausedUntil!.toISOString()}`, isSimulated: q.provider === "demo" },
        "UTC",
      );
    }
  }
}

export async function recentEvents(workspaceId: string, limit = 50) {
  return db.select().from(alertEvents).where(eq(alertEvents.workspaceId, workspaceId)).orderBy(desc(alertEvents.firedAt)).limit(limit);
}
