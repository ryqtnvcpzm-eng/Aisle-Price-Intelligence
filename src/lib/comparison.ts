/**
 * Comparison engine. Pure: takes the confirmed members of a comparison group
 * and their current prices/quantities, returns normalized prices, ranks,
 * premiums vs. benchmark, and plain-English findings — each backed by the
 * numbers it states. Items are compared only when genuinely comparable:
 * same currency, a price, and a quantity in the basis's dimension.
 */
import { formatMoney, formatPct, medianMinor } from "./money";
import { NORMALIZATION_BASES, unitPriceMinor, type NormalizationBasis, type QuantityLike } from "./quantity";

export interface ComparisonInput {
  id: string;
  brandName: string | null;
  label: string;
  productTitle: string;
  role: "reference" | "competitor";
  status: "confirmed" | "suggested";
  priceMinor: number | null;
  currency: string | null;
  availability: string;
  quantities: QuantityLike[];
}

export type IncomparableReason = "suggested" | "no_price" | "no_quantity" | "dimension_mismatch" | "currency_mismatch";

export interface ComparisonRow extends ComparisonInput {
  unitPriceMinor: number | null;
  comparable: boolean;
  reason: IncomparableReason | null;
  rank: number | null;
  /** (unit − benchmark) / benchmark, where benchmark = competitor median. */
  premium: number | null;
  gapMinor: number | null;
  /** 0 = cheapest, 1 = most expensive among comparable. */
  position: number | null;
}

export interface Finding {
  id: string;
  tone: "positive" | "negative" | "neutral" | "warning";
  text: string;
  itemIds: string[];
  metrics: Record<string, number | string | null>;
}

export interface ComparisonResult {
  basis: NormalizationBasis;
  currency: string | null;
  rows: ComparisonRow[];
  comparableCount: number;
  cheapest: ComparisonRow | null;
  mostExpensive: ComparisonRow | null;
  competitorMedian: number | null;
  referenceBest: ComparisonRow | null;
  undercutters: ComparisonRow[];
  spread: number | null;
  findings: Finding[];
}

const REASON_COPY: Record<IncomparableReason, string> = {
  suggested: "Suggested match — confirm it to include in calculations",
  no_price: "No current price (unavailable or not reported)",
  no_quantity: "Quantity unknown — add it to normalize",
  dimension_mismatch: "Quantity measured differently from this group's basis",
  currency_mismatch: "Priced in a different currency",
};
export function reasonCopy(r: IncomparableReason | null) {
  return r ? REASON_COPY[r] : "";
}

export function compare(items: ComparisonInput[], basis: NormalizationBasis, locale = "en-IN"): ComparisonResult {
  // Majority currency among confirmed priced items defines the group currency.
  const counts = new Map<string, number>();
  for (const it of items) if (it.status === "confirmed" && it.currency && it.priceMinor !== null) counts.set(it.currency, (counts.get(it.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const def = NORMALIZATION_BASES[basis];

  const rows: ComparisonRow[] = items.map((it) => {
    let reason: IncomparableReason | null = null;
    let unit: number | null = null;
    if (it.status === "suggested") reason = "suggested";
    else if (it.priceMinor === null) reason = "no_price";
    else if (currency && it.currency !== currency) reason = "currency_mismatch";
    else if (!it.quantities.length && def.dimension !== "pack") reason = "no_quantity";
    else {
      unit = unitPriceMinor(it.priceMinor, it.quantities, basis);
      if (unit === null) reason = it.quantities.length ? "dimension_mismatch" : "no_quantity";
    }
    return { ...it, unitPriceMinor: unit, comparable: reason === null, reason, rank: null, premium: null, gapMinor: null, position: null };
  });

  const comparable = rows.filter((r) => r.comparable).sort((a, b) => a.unitPriceMinor! - b.unitPriceMinor!);
  // Dense ranking so equal unit prices share a rank.
  let rank = 0;
  let prev: number | null = null;
  for (const r of comparable) {
    if (r.unitPriceMinor !== prev) rank++;
    r.rank = rank;
    prev = r.unitPriceMinor;
  }
  const lo = comparable[0]?.unitPriceMinor ?? null;
  const hi = comparable.at(-1)?.unitPriceMinor ?? null;
  for (const r of comparable) r.position = hi !== null && lo !== null && hi > lo ? (r.unitPriceMinor! - lo) / (hi - lo) : 0;

  const competitors = comparable.filter((r) => r.role === "competitor");
  const references = comparable.filter((r) => r.role === "reference");
  const competitorMedian = medianMinor(competitors.map((r) => r.unitPriceMinor!));
  if (competitorMedian !== null && competitorMedian > 0) {
    for (const r of comparable) {
      r.gapMinor = r.unitPriceMinor! - competitorMedian;
      r.premium = r.gapMinor / competitorMedian;
    }
  }
  const referenceBest = references[0] ?? null;
  const undercutters = referenceBest ? competitors.filter((c) => c.unitPriceMinor! < referenceBest.unitPriceMinor!) : [];

  const findings: Finding[] = [];
  const fmt = (v: number) => `${formatMoney(v, currency ?? "INR", locale, { trimZeros: false })}${def.label}`;
  const cheapest = comparable[0] ?? null;
  const mostExpensive = comparable.at(-1) ?? null;

  if (referenceBest && competitorMedian !== null && competitors.length) {
    const p = (referenceBest.unitPriceMinor! - competitorMedian) / competitorMedian;
    const n = competitors.length;
    const who = `${referenceBest.brandName ?? "Your"}'s ${referenceBest.label} listing`;
    const vs = n === 1 ? "the one comparable competitor listing" : `the median of the ${n} comparable competitor listings`;
    const text =
      Math.abs(p) < 0.005
        ? `${who} is priced in line with ${vs} (${fmt(referenceBest.unitPriceMinor!)}).`
        : `${who} is priced ${formatPct(Math.abs(p))} ${p > 0 ? "above" : "below"} ${vs} on a ${def.long} basis.`;
    findings.push({ id: "reference-vs-median", tone: p > 0.05 ? "negative" : p < -0.02 ? "positive" : "neutral", text, itemIds: [referenceBest.id, ...competitors.map((c) => c.id)], metrics: { referenceUnit: referenceBest.unitPriceMinor, competitorMedian, premium: p, competitors: n } });
  }
  if (cheapest && comparable.length >= 2) {
    findings.push({
      id: "cheapest",
      tone: cheapest.role === "reference" ? "positive" : "neutral",
      text: `${cheapest.brandName ?? "Unbranded"} ${cheapest.label} is the lowest-priced comparable option at ${fmt(cheapest.unitPriceMinor!)}.`,
      itemIds: [cheapest.id],
      metrics: { unit: cheapest.unitPriceMinor },
    });
  }
  if (undercutters.length && referenceBest) {
    const best = undercutters[0]!;
    const gap = (referenceBest.unitPriceMinor! - best.unitPriceMinor!) / referenceBest.unitPriceMinor!;
    findings.push({
      id: "undercut",
      tone: "warning",
      text: `${undercutters.length} competitor listing${undercutters.length === 1 ? " undercuts" : "s undercut"} ${referenceBest.brandName ? `${referenceBest.brandName}'s` : "your"} best unit price; ${best.brandName ?? "one"} ${best.label} is ${formatPct(gap)} cheaper ${def.long}.`,
      itemIds: undercutters.map((u) => u.id),
      metrics: { count: undercutters.length, gap },
    });
  }
  const spread = lo !== null && hi !== null && lo > 0 ? (hi - lo) / lo : null;
  if (spread !== null && comparable.length >= 3 && spread > 0.25) {
    findings.push({ id: "spread", tone: "neutral", text: `Unit prices in this group span ${formatPct(spread)} from cheapest to most expensive.`, itemIds: [], metrics: { spread } });
  }
  const oos = rows.filter((r) => r.status === "confirmed" && r.availability === "out_of_stock");
  if (oos.length) {
    findings.push({ id: "oos", tone: "warning", text: `${oos.length} listing${oos.length === 1 ? " is" : "s are"} currently unavailable: ${oos.map((o) => `${o.brandName ?? ""} ${o.label}`.trim()).join(", ")}.`, itemIds: oos.map((o) => o.id), metrics: { count: oos.length } });
  }
  const excluded = rows.filter((r) => !r.comparable && r.status === "confirmed");
  if (excluded.length) {
    findings.push({ id: "excluded", tone: "neutral", text: `${excluded.length} confirmed listing${excluded.length === 1 ? " was" : "s were"} left out of the calculations (missing price, quantity or matching currency).`, itemIds: excluded.map((e) => e.id), metrics: { count: excluded.length } });
  }

  return { basis, currency, rows, comparableCount: comparable.length, cheapest, mostExpensive, competitorMedian, referenceBest, undercutters, spread, findings };
}

/**
 * Comparability score for *suggestions* only (never auto-confirmed): category,
 * quantity dimension and size proximity. Titles alone never qualify a match.
 */
export function comparabilityScore(
  a: { category: string | null; dimension: string | null; totalMilli: number | null },
  b: { category: string | null; dimension: string | null; totalMilli: number | null },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (a.category && b.category && a.category === b.category) {
    score += 0.5;
    reasons.push("Same category");
  }
  if (a.dimension && a.dimension === b.dimension) {
    score += 0.3;
    reasons.push(`Both measured by ${a.dimension}`);
    if (a.totalMilli && b.totalMilli) {
      const r = Math.min(a.totalMilli, b.totalMilli) / Math.max(a.totalMilli, b.totalMilli);
      if (r >= 0.5) {
        score += 0.2 * r;
        reasons.push(r > 0.95 ? "Same pack size" : "Similar pack size");
      }
    }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}
