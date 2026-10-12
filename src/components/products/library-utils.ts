import type { FreshnessState } from "@/lib/freshness";
import { pctChange } from "@/lib/money";
import { defaultBasisFor, NORMALIZATION_BASES, unitPriceMinor, type NormalizationBasis } from "@/lib/quantity";
import type { FamilySummary, VariantRow } from "@/server/catalog/queries";

export function variantBasis(v: Pick<VariantRow, "quantities">): NormalizationBasis | null {
  const order = ["mass", "volume", "count", "serving"] as const;
  for (const d of order) if (v.quantities.some((q) => q.dimension === d)) return defaultBasisFor(d);
  return null;
}

export function unitOf(v: VariantRow): { minor: number | null; label: string | null; basis: NormalizationBasis | null } {
  const basis = variantBasis(v);
  if (!basis) return { minor: null, label: null, basis: null };
  return { minor: unitPriceMinor(v.priceMinor, v.quantities, basis), label: NORMALIZATION_BASES[basis].label, basis };
}

const FRESH_RANK: Record<FreshnessState, number> = { failed: 0, unavailable: 1, provider_stale: 2, pending: 3, paused: 4, verified: 5 };

export interface FamilyStats {
  min: number | null;
  max: number | null;
  currency: string | null;
  best: { variant: VariantRow; unit: number; label: string } | null;
  change7d: number | null;
  freshness: FreshnessState;
  inStock: number;
  oos: number;
  tracked: number;
}

export function familyStats(f: FamilySummary): FamilyStats {
  const visible = f.variants.filter((v) => !v.hidden);
  const priced = visible.filter((v) => v.priceMinor !== null);
  const currency = priced[0]?.currency ?? f.variants[0]?.currency ?? null;
  const same = priced.filter((v) => v.currency === currency);
  let best: FamilyStats["best"] = null;
  for (const v of visible) {
    const u = unitOf(v);
    if (u.minor !== null && u.label && (!best || u.minor < best.unit)) best = { variant: v, unit: u.minor, label: u.label };
  }
  const ch = visible.map((v) => pctChange(v.p7, v.priceMinor)).filter((x): x is number => x !== null);
  return {
    min: same.length ? Math.min(...same.map((v) => v.priceMinor!)) : null,
    max: same.length ? Math.max(...same.map((v) => v.priceMinor!)) : null,
    currency,
    best: visible.length > 1 ? best : null,
    change7d: ch.length ? ch.reduce((s, x) => s + x, 0) / ch.length : null,
    freshness: visible.reduce<FreshnessState>((w, v) => (FRESH_RANK[v.freshness] < FRESH_RANK[w] ? v.freshness : w), "verified"),
    inStock: visible.filter((v) => v.availability === "in_stock").length,
    oos: visible.filter((v) => v.availability === "out_of_stock").length,
    tracked: f.variants.filter((v) => v.tracked).length,
  };
}
