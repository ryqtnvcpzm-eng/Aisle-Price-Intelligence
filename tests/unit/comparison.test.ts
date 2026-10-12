import { describe, expect, it } from "vitest";
import { compare, comparabilityScore, type ComparisonInput } from "@/lib/comparison";

const item = (id: string, brand: string, priceMinor: number | null, grams: number | null, extra: Partial<ComparisonInput> = {}): ComparisonInput => ({
  id,
  brandName: brand,
  label: grams ? `${grams} g` : "?",
  productTitle: `${brand} protein`,
  role: brand === "Ref" ? "reference" : "competitor",
  status: "confirmed",
  priceMinor,
  currency: "INR",
  availability: "in_stock",
  quantities: grams ? [{ dimension: "mass", totalMilli: grams * 1000, packCount: 1 }] : [],
  ...extra,
});

describe("compare", () => {
  const rows = [
    item("r1", "Ref", 220_000, 1000), // ₹220/100g
    item("a", "A", 200_000, 1000), // ₹200
    item("b", "B", 110_000, 500), // ₹220
    item("c", "C", 360_000, 2000), // ₹180
  ];

  it("ranks by normalized price with dense ranks and correct premiums", () => {
    const r = compare(rows, "per_100g");
    expect(r.comparableCount).toBe(4);
    expect(r.cheapest?.id).toBe("c");
    expect(r.rows.find((x) => x.id === "r1")!.rank).toBe(r.rows.find((x) => x.id === "b")!.rank); // ties share a rank
    expect(r.competitorMedian).toBe(20_000);
    expect(r.referenceBest?.premium).toBeCloseTo(0.1);
    expect(r.undercutters.map((u) => u.id).sort()).toEqual(["a", "c"]);
  });

  it("writes plain-English findings backed by numbers", () => {
    const r = compare(rows, "per_100g");
    const f = r.findings.find((x) => x.id === "reference-vs-median")!;
    expect(f.text).toContain("10% above the median of the 3 comparable competitor listings");
    expect(f.metrics.premium).toBeCloseTo(0.1);
  });

  it("excludes incomparable items with explicit reasons instead of coercing them", () => {
    const r = compare(
      [
        ...rows,
        item("s", "S", 100_000, 1000, { status: "suggested" }),
        item("n", "N", null, 1000),
        item("q", "Q", 100_000, null),
        item("u", "U", 100_000, 1000, { currency: "USD" }),
        item("t", "T", 64_900, null, { quantities: [{ dimension: "count", totalMilli: 60_000, packCount: 1 }] }),
      ],
      "per_100g",
    );
    const reason = (id: string) => r.rows.find((x) => x.id === id)!.reason;
    expect(reason("s")).toBe("suggested");
    expect(reason("n")).toBe("no_price");
    expect(reason("q")).toBe("no_quantity");
    expect(reason("u")).toBe("currency_mismatch");
    expect(reason("t")).toBe("dimension_mismatch");
    expect(r.comparableCount).toBe(4);
  });

  it("suggestions require category + dimension, never just titles", () => {
    expect(comparabilityScore({ category: "Protein", dimension: "mass", totalMilli: 1e6 }, { category: "Protein", dimension: "mass", totalMilli: 1e6 }).score).toBeGreaterThanOrEqual(0.95);
    expect(comparabilityScore({ category: "Protein", dimension: "mass", totalMilli: 1e6 }, { category: "Vitamins", dimension: "count", totalMilli: 6e4 }).score).toBe(0);
  });
});
