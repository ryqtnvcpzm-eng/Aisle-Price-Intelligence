import "server-only";
import { computeStats, DAY, detectEvents, HOUR, inferMaxGap, priceAt, type Obs } from "@/lib/analytics";
import { compare } from "@/lib/comparison";
import { formatMoney, formatPct, medianMinor } from "@/lib/money";
import { defaultBasisFor, isNormalizationBasis, unitPriceMinor } from "@/lib/quantity";
import { loadSeries } from "../analytics/series";
import { listGroups, listVariantRows, type VariantRow } from "../catalog/queries";
import { getGroupDetail } from "../comparison/service";

export type InsightKind =
  | "competitor_cut"
  | "competitor_raise"
  | "observed_low"
  | "brand_premium"
  | "reference_lost_lead"
  | "volatility_up"
  | "unit_economics"
  | "competitor_unavailable"
  | "discount_ended";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: number; // 0..100, used for ordering
  tone: "positive" | "negative" | "neutral" | "warning";
  headline: string;
  explanation: string;
  items: { variantId: string; familyId: string; name: string }[];
  metrics: Record<string, number | string | null>;
  period: string;
  evidence: string[];
  at: string;
  coverage: { observations: number; share: number | null };
  href: string;
  isSimulated: boolean;
}

const nameOf = (v: VariantRow) => `${v.brandName ? `${v.brandName} ` : ""}${v.label}`;
const shortTitle = (v: VariantRow) => v.familyTitle.replace(v.brandName ?? "", "").split(/[,(]/)[0]!.trim();
const fmt = (v: VariantRow, m: number | null) => formatMoney(m, v.currency ?? "INR");

/**
 * Deterministic, rule-based insights computed from stored observations only.
 * Each insight carries the exact numbers and window it's based on; none makes
 * causal claims about *why* a price moved.
 */
export async function computeInsights(workspaceId: string, opts: { significantPct?: number; now?: number } = {}): Promise<Insight[]> {
  const now = opts.now ?? Date.now();
  const sig = (opts.significantPct ?? 3) / 100;
  const rows = (await listVariantRows(workspaceId)).filter((r) => r.tracked && !r.hidden);
  if (!rows.length) return [];
  const series = await loadSeries([...new Set(rows.map((r) => r.listingId))], new Date(now - 60 * DAY));
  const out: Insight[] = [];
  const base = (v: VariantRow) => ({ items: [{ variantId: v.variantId, familyId: v.familyId, name: nameOf(v) }], isSimulated: v.isSimulated, href: `/products/${v.familyId}?variant=${v.variantId}` });

  for (const v of rows) {
    const pts: Obs[] = series.get(v.listingId) ?? [];
    if (!pts.length) continue;
    const gap = inferMaxGap(pts);
    const cur = priceAt(pts, now, Math.max(gap, 48 * HOUR));
    const dayAgo = priceAt(pts, now - DAY, Math.max(gap, 12 * HOUR));
    const stats30 = computeStats(pts, now - 30 * DAY, now, gap);
    const isCompetitor = !v.isReferenceBrand;

    // 1. Competitor moves in the last 24h.
    if (isCompetitor && cur.known && dayAgo.known && cur.price !== null && dayAgo.price !== null && cur.price !== dayAgo.price) {
      const r = (cur.price - dayAgo.price) / dayAgo.price;
      if (Math.abs(r) >= sig) {
        const lastChange = [...pts].reverse().find((p, i, arr) => arr[i + 1] && arr[i + 1]!.price !== p.price);
        out.push({
          id: `move:${v.variantId}`,
          kind: r < 0 ? "competitor_cut" : "competitor_raise",
          severity: Math.min(95, 50 + Math.abs(r) * 300),
          tone: r < 0 ? "warning" : "neutral",
          headline: `${v.brandName ?? "A competitor"} ${r < 0 ? "reduced" : "raised"} ${shortTitle(v)} ${v.label} by ${formatPct(Math.abs(r))}`,
          explanation: `Observed at ${fmt(v, cur.price)}, ${r < 0 ? "down" : "up"} from ${fmt(v, dayAgo.price)} 24 hours earlier.`,
          metrics: { from: dayAgo.price, to: cur.price, ratio: r },
          period: "Last 24 hours",
          evidence: [`${fmt(v, dayAgo.price)} in effect at ${new Date(now - DAY).toISOString()}`, `${fmt(v, cur.price)} in effect now${lastChange ? ` (changed ${new Date(lastChange.t).toISOString()})` : ""}`],
          at: new Date(lastChange?.t ?? now).toISOString(),
          coverage: { observations: stats30.observations, share: stats30.coverage },
          ...base(v),
        });
      }
    }

    // 2. Observed 30-day low (needs reasonable coverage to be meaningful).
    if (cur.price !== null && stats30.coverage >= 0.6) {
      const prior = pts.filter((p) => p.t >= now - 30 * DAY && p.t < now - 2 * HOUR && p.price !== null).map((p) => p.price!);
      const priorMin = prior.length ? Math.min(...prior) : null;
      if (priorMin !== null && cur.price < priorMin) {
        out.push({
          id: `low:${v.variantId}`,
          kind: "observed_low",
          severity: isCompetitor ? 60 : 55,
          tone: isCompetitor ? "warning" : "positive",
          headline: `${nameOf(v)} is at its lowest observed price in 30 days`,
          explanation: `${fmt(v, cur.price)} is below every price Aisle recorded for it in the past 30 days (previous low ${fmt(v, priorMin)}).`,
          metrics: { price: cur.price, previousLow: priorMin },
          period: "Last 30 days",
          evidence: [`${stats30.observations} observations, ${formatPct(stats30.coverage)} of the window covered`],
          at: new Date(now).toISOString(),
          coverage: { observations: stats30.observations, share: stats30.coverage },
          ...base(v),
        });
      }
    }

    // 3. Volatility up: last 14d vs prior 14d, competitors only.
    if (isCompetitor) {
      const recent = computeStats(pts, now - 14 * DAY, now, gap);
      const prior = computeStats(pts, now - 28 * DAY, now - 14 * DAY, gap);
      if (recent.changeCount >= 4 && recent.changeCount >= 2 * Math.max(1, prior.changeCount) && recent.coverage > 0.5 && prior.coverage > 0.5) {
        out.push({
          id: `vol:${v.variantId}`,
          kind: "volatility_up",
          severity: 45,
          tone: "neutral",
          headline: `${nameOf(v)} is changing price more often`,
          explanation: `${recent.changeCount} observed price changes in the last 14 days, versus ${prior.changeCount} in the 14 days before.`,
          metrics: { recentChanges: recent.changeCount, priorChanges: prior.changeCount },
          period: "Last 28 days",
          evidence: [`Coverage ${formatPct(recent.coverage)} (recent) and ${formatPct(prior.coverage)} (prior)`],
          at: new Date(now).toISOString(),
          coverage: { observations: recent.observations + prior.observations, share: (recent.coverage + prior.coverage) / 2 },
          ...base(v),
        });
      }
    }

    // 4. Discount ended: within the last 3 days, price returned up to the 14-day baseline after a ≥10% dip.
    const events = detectEvents(pts.filter((p) => p.t >= now - 17 * DAY));
    const ended = events.find((e) => e.kind === "baseline" && e.t >= now - 3 * DAY && e.ratio !== null && e.ratio >= 0.1);
    if (ended) {
      out.push({
        id: `disc:${v.variantId}:${ended.t}`,
        kind: "discount_ended",
        severity: isCompetitor ? 50 : 40,
        tone: "neutral",
        headline: `A ${formatPct(1 - ended.from! / ended.to!)} discount on ${nameOf(v)} has ended`,
        explanation: `The price returned from ${fmt(v, ended.from)} to its recent typical level of ${fmt(v, ended.to)}.`,
        metrics: { from: ended.from, to: ended.to },
        period: "Last 3 days",
        evidence: [`Typical level = most common observed price over the preceding 14 days`],
        at: new Date(ended.t).toISOString(),
        coverage: { observations: stats30.observations, share: stats30.coverage },
        ...base(v),
      });
    }

    // 5. Competitor unavailable now.
    if (isCompetitor && v.availability === "out_of_stock" && v.groups.length) {
      out.push({
        id: `oos:${v.variantId}`,
        kind: "competitor_unavailable",
        severity: 58,
        tone: "warning",
        headline: `${nameOf(v)} is currently unavailable`,
        explanation: `The latest observation reports no purchasable offer. It's part of ${v.groups.map((g) => `“${g.name}”`).join(", ")}.`,
        metrics: { lastSeen: v.lowest },
        period: "Latest observation",
        evidence: [`Observed ${v.lastObservedAt ?? "unknown"}`],
        at: v.lastObservedAt ?? new Date(now).toISOString(),
        coverage: { observations: v.observationCount, share: null },
        ...base(v),
      });
    }
  }

  // 6. Unit economics within a family: one size materially cheaper per unit than the family median.
  const byFamily = new Map<string, VariantRow[]>();
  for (const v of rows) byFamily.set(v.familyId, [...(byFamily.get(v.familyId) ?? []), v]);
  for (const fam of byFamily.values()) {
    if (fam.length < 2) continue;
    const dim = fam[0]!.quantities[0]?.dimension;
    const basis = defaultBasisFor(dim);
    if (!basis) continue;
    const units = fam.map((v) => ({ v, u: unitPriceMinor(v.priceMinor, v.quantities, basis) })).filter((x) => x.u !== null) as { v: VariantRow; u: number }[];
    if (units.length < 2) continue;
    const med = medianMinor(units.map((x) => x.u))!;
    const best = units.sort((a, b) => a.u - b.u)[0]!;
    const worst = units.at(-1)!;
    const saving = (worst.u - best.u) / worst.u;
    if (saving >= 0.15 && best.u < med) {
      out.push({
        id: `unit:${best.v.familyId}`,
        kind: "unit_economics",
        severity: 35,
        tone: "positive",
        headline: `${best.v.brandName ?? ""} ${shortTitle(best.v)}: the ${best.v.label} is ${formatPct(saving)} cheaper per unit than the ${worst.v.label}`.trim(),
        explanation: `${formatMoney(best.u, best.v.currency ?? "INR", undefined, { trimZeros: false })} versus ${formatMoney(worst.u, worst.v.currency ?? "INR", undefined, { trimZeros: false })} on a normalized basis, using current prices and stated pack sizes.`,
        items: [best.v, worst.v].map((x) => ({ variantId: x.variantId, familyId: x.familyId, name: nameOf(x) })),
        metrics: { best: best.u, worst: worst.u, saving },
        period: "Current prices",
        evidence: best.v.quantities.concat(worst.v.quantities).map((q) => `Quantity “${q.matchedText ?? q.unit}” (${q.confidence})`),
        at: new Date(now).toISOString(),
        coverage: { observations: units.length, share: null },
        isSimulated: best.v.isSimulated,
        href: `/products/${best.v.familyId}`,
      });
    }
  }

  // 7. Group-level: brand premium and lost price leadership.
  const groups = await listGroups(workspaceId);
  const premiumsByBrand = new Map<string, { name: string; premiums: number[]; sim: boolean }>();
  for (const g of groups) {
    if (g.item_count < 2) continue;
    const detail = await getGroupDetail(workspaceId, g.id);
    for (const r of detail.result.rows) {
      if (!r.comparable || r.premium === null || !r.brandName) continue;
      const e = premiumsByBrand.get(r.brandName) ?? { name: r.brandName, premiums: [], sim: false };
      e.premiums.push(r.premium);
      e.sim ||= detail.items.some((i) => i.isSimulated);
      premiumsByBrand.set(r.brandName, e);
    }
    // Lost leadership: reference cheapest 7 days ago, not now.
    const ref = detail.result.referenceBest;
    if (!ref) continue;
    const basis = isNormalizationBasis(detail.group.basis) ? detail.group.basis : "per_100g";
    const past = compare(
      detail.items.map((i) => {
        const pts = series.get(i.listingId) ?? [];
        const p = priceAt(pts, now - 7 * DAY, Math.max(inferMaxGap(pts), 12 * HOUR));
        return { id: i.variantId, brandName: i.brandName, label: i.label, productTitle: i.familyTitle, role: i.role, status: i.status, priceMinor: p.known ? p.price : null, currency: i.currency, availability: i.availability, quantities: i.quantities };
      }),
      basis,
    );
    const wasLeader = past.cheapest && past.cheapest.role === "reference";
    const isLeader = detail.result.cheapest?.role === "reference";
    if (wasLeader && !isLeader && detail.result.cheapest) {
      const leader = detail.result.cheapest;
      out.push({
        id: `lead:${g.id}`,
        kind: "reference_lost_lead",
        severity: 85,
        tone: "negative",
        headline: `${ref.brandName ?? "Your brand"} lost its price advantage in “${g.name}”`,
        explanation: `Seven days ago ${past.cheapest!.brandName} ${past.cheapest!.label} had the lowest unit price. Now ${leader.brandName} ${leader.label} does, at ${formatMoney(leader.unitPriceMinor, detail.result.currency ?? "INR", undefined, { trimZeros: false })}.`,
        items: detail.items.filter((i) => i.variantId === leader.id || i.variantId === ref.id).map((i) => ({ variantId: i.variantId, familyId: i.familyId, name: nameOf(i) })),
        metrics: { leaderUnit: leader.unitPriceMinor, referenceUnit: ref.unitPriceMinor },
        period: "Last 7 days",
        evidence: [`Compared on a ${basis.replace("per_", "per ")} basis using prices in effect at both times`],
        at: new Date(now).toISOString(),
        coverage: { observations: detail.items.length, share: null },
        isSimulated: detail.items.some((i) => i.isSimulated),
        href: `/comparisons/${g.id}`,
      });
    }
  }
  for (const b of premiumsByBrand.values()) {
    if (b.premiums.length < 2) continue;
    const med = [...b.premiums].sort((x, y) => x - y)[Math.floor(b.premiums.length / 2)]!;
    const consistent = b.premiums.filter((p) => p > 0.05).length / b.premiums.length >= 0.75;
    if (med > 0.1 && consistent) {
      out.push({
        id: `premium:${b.name}`,
        kind: "brand_premium",
        severity: 55,
        tone: "neutral",
        headline: `${b.name} is consistently priced above category peers`,
        explanation: `Across ${b.premiums.length} comparable listings in your comparison groups, ${b.name}'s median unit price is ${formatPct(med)} above the competitor median.`,
        items: [],
        metrics: { medianPremium: med, listings: b.premiums.length },
        period: "Current prices",
        evidence: [`Only confirmed, comparable listings are included`],
        at: new Date(now).toISOString(),
        coverage: { observations: b.premiums.length, share: null },
        isSimulated: b.sim,
        href: `/brands`,
      });
    }
  }

  return out.sort((a, b) => b.severity - a.severity);
}
