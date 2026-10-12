import "server-only";
import { medianMinor, pctChange } from "@/lib/money";
import { listGroups, listVariantRows, type VariantRow } from "../catalog/queries";
import { getGroupDetail } from "../comparison/service";
import { segmentBrands } from "../ml";

export interface BrandStats {
  name: string;
  brandId: string | null;
  isReference: boolean;
  families: number;
  variants: number;
  categories: string[];
  marketplaces: string[];
  comparableListings: number;
  /** Median of (brand unit price − other brands' median) / other brands' median, across groups. */
  medianPremium: number | null;
  premiumSamples: number;
  groupsCompeted: number;
  groupsLowest: number;
  discountedShare: number | null;
  inStockShare: number;
  avgChange7d: number | null;
  avgChange30d: number | null;
  /** Mean absolute 30-day price change across the brand's listings. */
  movement30d: number | null;
  /** Positioning segment from k-means over premium, discount share and movement (needs ≥4 brands with overlap). */
  segment: { label: string; cluster: number } | null;
  rows: VariantRow[];
}

/**
 * Brand statistics over *tracked listings only* — this is a view of the
 * products you monitor, not market share or a whole-category measurement.
 */
export async function brandAnalytics(workspaceId: string): Promise<BrandStats[]> {
  const rows = (await listVariantRows(workspaceId)).filter((r) => r.tracked);
  const byBrand = new Map<string, BrandStats>();
  for (const r of rows) {
    const key = r.brandName ?? "Unbranded";
    let b = byBrand.get(key);
    if (!b) {
      b = { name: key, brandId: r.brandId, isReference: r.isReferenceBrand, families: 0, variants: 0, categories: [], marketplaces: [], comparableListings: 0, medianPremium: null, premiumSamples: 0, groupsCompeted: 0, groupsLowest: 0, discountedShare: null, inStockShare: 0, avgChange7d: null, avgChange30d: null, movement30d: null, segment: null, rows: [] };
      byBrand.set(key, b);
    }
    b.rows.push(r);
  }

  const premiums = new Map<string, number[]>();
  const comparable = new Map<string, Set<string>>();
  for (const g of await listGroups(workspaceId)) {
    const d = await getGroupDetail(workspaceId, g.id);
    const comp = d.result.rows.filter((r) => r.comparable);
    const brandsInGroup = new Set(comp.map((r) => r.brandName ?? "Unbranded"));
    if (brandsInGroup.size < 2) continue;
    for (const brand of brandsInGroup) {
      const mine = comp.filter((r) => (r.brandName ?? "Unbranded") === brand);
      const others = comp.filter((r) => (r.brandName ?? "Unbranded") !== brand);
      const otherMed = medianMinor(others.map((o) => o.unitPriceMinor!));
      const s = byBrand.get(brand);
      if (!s || otherMed === null || otherMed === 0) continue;
      s.groupsCompeted++;
      if (d.result.cheapest && (d.result.cheapest.brandName ?? "Unbranded") === brand) s.groupsLowest++;
      for (const m of mine) {
        premiums.set(brand, [...(premiums.get(brand) ?? []), (m.unitPriceMinor! - otherMed) / otherMed]);
        comparable.set(brand, (comparable.get(brand) ?? new Set()).add(m.id));
      }
    }
  }

  for (const b of byBrand.values()) {
    b.families = new Set(b.rows.map((r) => r.familyId)).size;
    b.variants = b.rows.length;
    b.categories = [...new Set(b.rows.map((r) => r.categoryName).filter((x): x is string => Boolean(x)))];
    b.marketplaces = [...new Set(b.rows.map((r) => r.marketplace))];
    const p = (premiums.get(b.name) ?? []).sort((x, y) => x - y);
    b.premiumSamples = p.length;
    b.medianPremium = p.length ? p[Math.floor(p.length / 2)]! : null;
    b.comparableListings = comparable.get(b.name)?.size ?? 0;
    const withList = b.rows.filter((r) => r.listPriceMinor !== null && r.priceMinor !== null);
    b.discountedShare = withList.length ? withList.filter((r) => r.priceMinor! < r.listPriceMinor!).length / withList.length : null;
    b.inStockShare = b.rows.filter((r) => r.availability === "in_stock").length / b.rows.length;
    const c7 = b.rows.map((r) => pctChange(r.p7, r.priceMinor)).filter((x): x is number => x !== null);
    const c30 = b.rows.map((r) => pctChange(r.p30, r.priceMinor)).filter((x): x is number => x !== null);
    b.avgChange7d = c7.length ? c7.reduce((s, x) => s + x, 0) / c7.length : null;
    b.avgChange30d = c30.length ? c30.reduce((s, x) => s + x, 0) / c30.length : null;
    b.movement30d = c30.length ? c30.reduce((s, x) => s + Math.abs(x), 0) / c30.length : null;
  }

  // Positioning segments: only brands with a measured premium (i.e. that share comparison groups).
  const eligible = [...byBrand.values()].filter((b) => b.medianPremium !== null);
  const segments = segmentBrands(eligible.map((b) => ({ id: b.name, premium: b.medianPremium!, discountedShare: b.discountedShare ?? 0, movement: b.movement30d ?? 0 })));
  for (const b of eligible) {
    const s = segments.get(b.name);
    if (s) b.segment = { label: s.label, cluster: s.cluster };
  }
  return [...byBrand.values()].sort((a, b) => Number(b.isReference) - Number(a.isReference) || b.variants - a.variants);
}
