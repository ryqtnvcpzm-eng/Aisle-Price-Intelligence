import "server-only";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { compare, type ComparisonInput } from "@/lib/comparison";
import { formatMoney, formatPct, medianMinor } from "@/lib/money";
import { isNormalizationBasis, NORMALIZATION_BASES, type Dimension, type NormalizationBasis } from "@/lib/quantity";
import type { BriefingContent, BriefingListing, BriefingMove, PositionPoint } from "@/lib/briefing-types";
import { addDays, localMidnight, type Week } from "@/lib/week";
import { db } from "../db/client";
import { alertEvents, alertRules, brands, categories, comparisonGroups, comparisonItems, listings, priceObservations, productFamilies, variantQuantities, variants } from "../db/schema";

/**
 * The Monday Briefing: what happened to prices in one finished week.
 *
 * Built only from stored observations. A price "at" a moment is the last
 * observation at or before it, and only if that observation is recent enough
 * (STALE_AFTER); otherwise it is missing — never zero, never interpolated.
 * Changes are only measured between observations of the same provenance, so a
 * simulated price is never compared with a verified one.
 */

const STALE_AFTER_MS = 72 * 3_600_000;
const DROP_THRESHOLD = 0.05;

interface Obs {
  listingId: string;
  at: number;
  price: number | null;
  availability: string;
  sim: boolean;
  currency: string;
}

function priceAt(series: Obs[] | undefined, t: number): Obs | null {
  if (!series) return null;
  let found: Obs | null = null;
  for (const o of series) {
    if (o.at > t) break;
    found = o;
  }
  if (!found || t - found.at > STALE_AFTER_MS || found.price === null) return null;
  return found;
}

function shortName(familyTitle: string, brand: string | null, label: string) {
  const product = familyTitle.replace(brand ?? "", "").split(/[,(]/)[0]!.trim();
  return `${product} · ${label}`;
}

export async function buildBriefing(workspaceId: string, week: Week): Promise<{ content: BriefingContent; containsSimulated: boolean; referenceBrand: { id: string; name: string } | null }> {
  const t0 = week.periodStart.getTime();
  const t1 = week.periodEnd.getTime();
  const [ref] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.workspaceId, workspaceId), eq(brands.isReference, true)));
  const referenceBrand = ref ?? null;

  const rows = await db
    .select({ variantId: variants.id, listingId: variants.listingId, label: variants.label, familyId: productFamilies.id, familyTitle: productFamilies.title, brandId: productFamilies.brandId, brandName: brands.name, category: categories.name, currency: listings.currency, lastFailureAt: listings.lastFailureAt })
    .from(variants)
    .innerJoin(productFamilies, eq(productFamilies.id, variants.familyId))
    .innerJoin(listings, eq(listings.id, variants.listingId))
    .leftJoin(brands, eq(brands.id, productFamilies.brandId))
    .leftJoin(categories, eq(categories.id, productFamilies.categoryId))
    .where(and(eq(variants.workspaceId, workspaceId), eq(variants.tracked, true), isNull(productFamilies.archivedAt)));
  const listingIds = [...new Set(rows.map((r) => r.listingId))];
  const meta = new Map(rows.map((r) => [r.variantId, { variantId: r.variantId, familyId: r.familyId, name: shortName(r.familyTitle, r.brandName, r.label), brandName: r.brandName, isReference: Boolean(referenceBrand && r.brandId === referenceBrand.id), currency: r.currency } satisfies BriefingListing]));

  // Observations from a lookback before the week (so "price at Monday 00:00" exists) to its end.
  const obsRows = listingIds.length
    ? await db
        .select({ listingId: priceObservations.listingId, at: priceObservations.observedAt, price: priceObservations.priceMinor, availability: priceObservations.availability, sim: priceObservations.isSimulated, currency: priceObservations.currency })
        .from(priceObservations)
        .where(and(inArray(priceObservations.listingId, listingIds), gte(priceObservations.observedAt, new Date(t0 - STALE_AFTER_MS)), lt(priceObservations.observedAt, week.periodEnd)))
        .orderBy(priceObservations.listingId, priceObservations.observedAt)
    : [];
  const series = new Map<string, Obs[]>();
  for (const o of obsRows) {
    const list = series.get(o.listingId) ?? [];
    list.push({ listingId: o.listingId, at: o.at.getTime(), price: o.price, availability: o.availability, sim: o.sim, currency: o.currency });
    series.set(o.listingId, list);
  }
  const inWeek = obsRows.filter((o) => o.at.getTime() >= t0);
  const containsSimulated = inWeek.some((o) => o.sim);

  const qs = rows.length ? await db.select({ variantId: variantQuantities.variantId, dimension: variantQuantities.dimension, totalMilli: variantQuantities.totalMilli, packCount: variantQuantities.packCount, confidence: variantQuantities.confidence }).from(variantQuantities).where(inArray(variantQuantities.variantId, rows.map((r) => r.variantId))) : [];
  const qByVariant = new Map<string, { dimension: Dimension; totalMilli: number; packCount: number; confidence: string }[]>();
  for (const q of qs) qByVariant.set(q.variantId, [...(qByVariant.get(q.variantId) ?? []), q]);
  const listingOf = new Map(rows.map((r) => [r.variantId, r.listingId]));

  // ── C: movers (start vs end of week, same provenance only) ──────────────
  const moves: BriefingMove[] = [];
  for (const r of rows) {
    const a = priceAt(series.get(r.listingId), t0);
    const b = priceAt(series.get(r.listingId), t1 - 1);
    if (!a || !b || a.sim !== b.sim || a.currency !== b.currency || a.price === b.price) continue;
    moves.push({ listing: meta.get(r.variantId)!, from: a.price!, to: b.price!, ratio: (b.price! - a.price!) / a.price!, currency: b.currency });
  }
  const movers = { down: moves.filter((m) => m.ratio < 0).sort((x, y) => x.ratio - y.ratio).slice(0, 5), up: moves.filter((m) => m.ratio > 0).sort((x, y) => y.ratio - x.ratio).slice(0, 5) };

  // ── E: consecutive-observation drops ≥ 5% inside the week ───────────────
  const drops: BriefingContent["drops"] = [];
  let priceChanges = 0;
  for (const r of rows) {
    const s = series.get(r.listingId) ?? [];
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1]!;
      const cur = s[i]!;
      if (cur.at < t0 || prev.price === null || cur.price === null || prev.sim !== cur.sim || prev.currency !== cur.currency) continue;
      if (cur.price !== prev.price) priceChanges++;
      const ratio = (cur.price - prev.price) / prev.price;
      if (ratio <= -DROP_THRESHOLD) drops.push({ listing: meta.get(r.variantId)!, from: prev.price, to: cur.price, ratio, at: new Date(cur.at).toISOString(), currency: cur.currency });
    }
  }
  drops.sort((a, b) => a.ratio - b.ratio);

  // ── B + D: managed comparisons at the start and the end of the week ─────
  const groups = await db
    .select({ id: comparisonGroups.id, name: comparisonGroups.name, basis: comparisonGroups.basis, refBrandId: comparisonGroups.referenceBrandId })
    .from(comparisonGroups)
    .where(and(eq(comparisonGroups.workspaceId, workspaceId), eq(comparisonGroups.managedBy, "reference_market"), isNull(comparisonGroups.archivedAt)));
  const items = groups.length ? await db.select({ groupId: comparisonItems.groupId, variantId: comparisonItems.variantId, status: comparisonItems.status }).from(comparisonItems).where(inArray(comparisonItems.groupId, groups.map((g) => g.id))) : [];
  const brandIdOf = new Map(rows.map((r) => [r.variantId, r.brandId]));
  const position: BriefingContent["position"] = [];
  const undercutAtEnd: BriefingContent["competitive"]["undercutAtEnd"] = [];
  for (const g of groups) {
    const basis: NormalizationBasis = isNormalizationBasis(g.basis) ? g.basis : "per_100g";
    const members = items.filter((i) => i.groupId === g.id && meta.has(i.variantId));
    const at = (t: number) => {
      const input: ComparisonInput[] = members.map((m) => {
        const o = priceAt(series.get(listingOf.get(m.variantId)!), t);
        const info = meta.get(m.variantId)!;
        return { id: m.variantId, brandName: info.brandName, label: info.name, productTitle: info.name, role: brandIdOf.get(m.variantId) === (g.refBrandId ?? referenceBrand?.id) ? "reference" : "competitor", status: m.status, priceMinor: o?.price ?? null, currency: o?.currency ?? null, availability: o?.availability ?? "unknown", quantities: (qByVariant.get(m.variantId) ?? []).map((q) => ({ dimension: q.dimension, totalMilli: q.totalMilli, packCount: q.packCount })) };
      });
      const res = compare(input, basis);
      return { res, point: res.comparableCount ? ({ referenceUnit: res.referenceBest?.unitPriceMinor ?? null, competitorMedian: res.competitorMedian, premium: res.referenceBest?.premium ?? null, rank: res.referenceBest?.rank ?? null, comparable: res.comparableCount, cheapestBrand: res.cheapest?.brandName ?? null, referenceIsCheapest: res.cheapest?.role === "reference" } satisfies PositionPoint) : null };
    };
    const start = at(t0);
    const end = at(t1 - 1);
    position.push({ groupId: g.id, name: g.name, basis, currency: end.res.currency ?? start.res.currency, start: start.point, end: end.point });
    undercutAtEnd.push({ groupId: g.id, name: g.name, undercutters: end.res.undercutters.length, best: end.res.undercutters[0] ? `${end.res.undercutters[0].brandName ?? "Unbranded"} ${end.res.undercutters[0].label}` : null });
  }

  const events = await db
    .select({ id: alertEvents.id, type: alertRules.type, headline: alertEvents.headline, firedAt: alertEvents.firedAt, isSimulated: alertEvents.isSimulated, managedKey: alertRules.managedKey })
    .from(alertEvents)
    .innerJoin(alertRules, eq(alertRules.id, alertEvents.ruleId))
    .where(and(eq(alertEvents.workspaceId, workspaceId), eq(alertEvents.isTest, false), gte(alertEvents.firedAt, week.periodStart), lt(alertEvents.firedAt, week.periodEnd)));
  const competitiveTypes = new Set(["competitor_undercut", "price_leadership_change", "leader_change"]);

  // ── F: daily index, 100 = price at the start of the week ────────────────
  const trend: BriefingContent["trend"] = [];
  for (let d = 0; d < 7; d++) {
    const dayEnd = localMidnight(addDays(week.weekStart, d + 1), week.timeZone).getTime() - 1;
    const ratios = { reference: [] as number[], competitors: [] as number[] };
    for (const r of rows) {
      const a = priceAt(series.get(r.listingId), t0);
      const b = priceAt(series.get(r.listingId), dayEnd);
      if (!a || !b || a.sim !== b.sim || a.currency !== b.currency) continue;
      (meta.get(r.variantId)!.isReference ? ratios.reference : ratios.competitors).push(Math.round((b.price! / a.price!) * 10_000));
    }
    const med = (xs: number[]) => {
      const m = medianMinor(xs);
      return m === null ? null : m / 100;
    };
    trend.push({ day: addDays(week.weekStart, d), reference: med(ratios.reference), competitors: med(ratios.competitors), referenceListings: ratios.reference.length, competitorListings: ratios.competitors.length });
  }

  // ── G: data confidence ──────────────────────────────────────────────────
  const observedListings = new Set(inWeek.map((o) => o.listingId));
  const trackedListings = listingIds.length;
  const quantities = { manual: 0, provider: 0, parsed: 0, unknown: 0, missing: 0 };
  for (const r of rows) {
    const q = qByVariant.get(r.variantId);
    if (!q?.length) quantities.missing++;
    else if (q.some((x) => x.confidence === "manual")) quantities.manual++;
    else if (q.some((x) => x.confidence === "provider")) quantities.provider++;
    else if (q.some((x) => x.confidence === "parsed")) quantities.parsed++;
    else quantities.unknown++;
  }
  const staleAtEnd = listingIds.filter((id) => !priceAt(series.get(id), t1 - 1)).length;
  const failures = rows.filter((r) => r.lastFailureAt && r.lastFailureAt.getTime() >= t0 && r.lastFailureAt.getTime() < t1).length;
  const simulatedObservations = inWeek.filter((o) => o.sim).length;
  const notes: string[] = [];
  if (simulatedObservations) notes.push(simulatedObservations === inWeek.length ? "Every observation this week is simulated demo data." : `${simulatedObservations} of ${inWeek.length} observations are simulated and are never compared with verified prices.`);
  if (staleAtEnd) notes.push(`${staleAtEnd} listing${staleAtEnd === 1 ? " has" : "s have"} no price within 72 hours of the week's end; they're shown as missing, not zero.`);
  if (quantities.missing) notes.push(`${quantities.missing} listing${quantities.missing === 1 ? " has" : "s have"} no pack size, so ${quantities.missing === 1 ? "it isn't" : "they aren't"} in unit-price comparisons.`);
  notes.push("Pack sizes are as currently recorded; prices are as observed.");

  // ── A: summary sentences, each backed by a number above ─────────────────
  const sentences: string[] = [];
  sentences.push(inWeek.length ? `${inWeek.length.toLocaleString("en-IN")} price observations across ${observedListings.size} of ${trackedListings} tracked listing${trackedListings === 1 ? "" : "s"}, with ${priceChanges} price change${priceChanges === 1 ? "" : "s"}.` : "No price observations were recorded this week.");
  const posWithBoth = position.filter((p) => p.start?.premium != null && p.end?.premium != null);
  if (referenceBrand && posWithBoth.length) {
    const moved = posWithBoth.map((p) => ({ p, delta: p.end!.premium! - p.start!.premium! })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0]!;
    const cat = moved.p.name.split(" · ")[1] ?? moved.p.name;
    sentences.push(Math.abs(moved.delta) < 0.005 ? `${referenceBrand.name}'s position held steady: ${formatPct(moved.p.end!.premium!, { signed: true })} vs the competitor median in ${cat}.` : `${referenceBrand.name} ended ${formatPct(moved.p.end!.premium!, { signed: true })} vs the competitor median in ${cat} (${moved.delta > 0 ? "up" : "down"} ${formatPct(Math.abs(moved.delta))} on the week).`);
  } else if (!referenceBrand) sentences.push("Choose your brand to see your position against the market.");
  if (drops.length) {
    const top = drops[0]!;
    sentences.push(`${drops.length} drop${drops.length === 1 ? "" : "s"} of 5% or more; the largest was ${top.listing.brandName ?? "a listing"} ${top.listing.name} at ${formatPct(Math.abs(top.ratio))} (${formatMoney(top.from, top.currency)} → ${formatMoney(top.to, top.currency)}).`);
  }
  const undercut = undercutAtEnd.filter((u) => u.undercutters > 0);
  if (referenceBrand && undercut.length) sentences.push(`At week's end, competitors undercut ${referenceBrand.name} in ${undercut.length} of ${undercutAtEnd.length} comparison${undercutAtEnd.length === 1 ? "" : "s"}.`);

  const content: BriefingContent = {
    week: { start: week.weekStart, end: week.weekEnd, timeZone: week.timeZone, periodStart: week.periodStart.toISOString(), periodEnd: week.periodEnd.toISOString() },
    referenceBrand,
    summary: { sentences, trackedListings, listingsObserved: observedListings.size, observations: inWeek.length, priceChanges, alertsFired: events.length, protectionAlerts: events.filter((e) => e.managedKey?.startsWith("protect:")).length },
    position,
    movers,
    competitive: { events: events.filter((e) => competitiveTypes.has(e.type)).map((e) => ({ id: e.id, type: e.type, headline: e.headline, firedAt: e.firedAt.toISOString(), isSimulated: e.isSimulated })).sort((a, b) => a.firedAt.localeCompare(b.firedAt)), undercutAtEnd },
    drops: drops.slice(0, 25),
    trend,
    confidence: { trackedListings, listingsWithObservations: observedListings.size, coverage: trackedListings ? observedListings.size / trackedListings : null, observations: inWeek.length, simulatedObservations, listingsWithFailures: failures, staleAtEnd, quantities, notes },
  };
  return { content, containsSimulated, referenceBrand };
}

export function basisLabel(b: string) {
  return isNormalizationBasis(b) ? NORMALIZATION_BASES[b].label : "";
}

