/**
 * Unit-compatibility cohorts for the managed "{Brand} vs Market" comparisons.
 *
 * Pure and brand-agnostic: the reference brand is whatever id the caller
 * passes (a workspace setting), never a name baked into code. Listings are
 * only grouped when a fair unit price exists across them — same marketplace
 * (so the same currency), same category and the same quantity dimension.
 * Everything that can't be placed is returned with a reason instead of being
 * silently dropped or compared on a basis it doesn't support.
 */
import { NORMALIZATION_BASES, defaultBasisFor, type Dimension, type NormalizationBasis } from "./quantity";

export interface CohortInput {
  variantId: string;
  familyId: string;
  familyTitle: string;
  label: string;
  brandId: string | null;
  brandName: string | null;
  marketplace: string;
  categoryName: string | null;
  tracked: boolean;
  hidden: boolean;
  quantities: { dimension: Dimension }[];
}

export type UnmatchedReason = "no_quantity" | "no_reference_in_cohort" | "no_competitor_in_cohort";

export interface Cohort {
  key: string;
  marketplace: string;
  categoryName: string | null;
  basis: NormalizationBasis;
  referenceVariantIds: string[];
  competitorVariantIds: string[];
}

export interface Unmatched {
  variantId: string;
  familyId: string;
  familyTitle: string;
  label: string;
  brandName: string | null;
  isReference: boolean;
  marketplace: string;
  categoryName: string | null;
  basis: NormalizationBasis | null;
  reason: UnmatchedReason;
}

const DIMENSION_ORDER: Dimension[] = ["mass", "volume", "count", "serving"];

/** The basis a listing is compared on: its first measurable dimension (mass, then volume, count, serving). */
export function cohortBasis(quantities: { dimension: Dimension }[]): NormalizationBasis | null {
  for (const d of DIMENSION_ORDER) if (quantities.some((q) => q.dimension === d)) return defaultBasisFor(d);
  return null;
}

export function categorySlug(name: string | null) {
  return (name ?? "uncategorized").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uncategorized";
}

export function cohortKey(marketplace: string, categoryName: string | null, basis: NormalizationBasis) {
  return `${marketplace}|${categorySlug(categoryName)}|${basis}`;
}

export function buildCohorts(rows: CohortInput[], referenceBrandId: string): { cohorts: Cohort[]; unmatched: Unmatched[] } {
  const buckets = new Map<string, Cohort>();
  const unmatched: Unmatched[] = [];
  const meta = new Map<string, CohortInput>();
  for (const r of rows) {
    if (!r.tracked || r.hidden) continue;
    meta.set(r.variantId, r);
    const isReference = r.brandId === referenceBrandId;
    const basis = cohortBasis(r.quantities);
    if (!basis) {
      unmatched.push(toUnmatched(r, isReference, null, "no_quantity"));
      continue;
    }
    const key = cohortKey(r.marketplace, r.categoryName, basis);
    let c = buckets.get(key);
    if (!c) {
      c = { key, marketplace: r.marketplace, categoryName: r.categoryName, basis, referenceVariantIds: [], competitorVariantIds: [] };
      buckets.set(key, c);
    }
    (isReference ? c.referenceVariantIds : c.competitorVariantIds).push(r.variantId);
  }
  const cohorts: Cohort[] = [];
  for (const c of buckets.values()) {
    if (c.referenceVariantIds.length && c.competitorVariantIds.length) {
      cohorts.push(c);
      continue;
    }
    const reason: UnmatchedReason = c.referenceVariantIds.length ? "no_competitor_in_cohort" : "no_reference_in_cohort";
    for (const id of [...c.referenceVariantIds, ...c.competitorVariantIds]) unmatched.push(toUnmatched(meta.get(id)!, c.referenceVariantIds.includes(id), c.basis, reason));
  }
  cohorts.sort((a, b) => a.marketplace.localeCompare(b.marketplace) || (a.categoryName ?? "").localeCompare(b.categoryName ?? "") || a.basis.localeCompare(b.basis));
  return { cohorts, unmatched };
}

function toUnmatched(r: CohortInput, isReference: boolean, basis: NormalizationBasis | null, reason: UnmatchedReason): Unmatched {
  return { variantId: r.variantId, familyId: r.familyId, familyTitle: r.familyTitle, label: r.label, brandName: r.brandName, isReference, marketplace: r.marketplace, categoryName: r.categoryName, basis, reason };
}

/** "{Brand} vs Market · {Category} · per 100 g" — the marketplace is appended only when the workspace spans several. */
export function cohortName(brandName: string, c: Pick<Cohort, "categoryName" | "basis" | "marketplace">, multiMarketplace: boolean) {
  const parts = [`${brandName} vs Market`, c.categoryName ?? "Uncategorized", NORMALIZATION_BASES[c.basis].long];
  if (multiMarketplace) parts.push(c.marketplace);
  return parts.join(" · ");
}

export function unmatchedCopy(u: Pick<Unmatched, "reason" | "isReference">, brandName: string) {
  switch (u.reason) {
    case "no_quantity":
      return "Pack size unknown — add a quantity so it can be compared per unit.";
    case "no_reference_in_cohort":
      return `No ${brandName} listing in the same category and unit to compare against.`;
    case "no_competitor_in_cohort":
      return "No competitor listing in the same category and unit yet.";
  }
}
