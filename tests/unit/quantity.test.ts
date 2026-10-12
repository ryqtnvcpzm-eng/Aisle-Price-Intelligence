import { describe, expect, it } from "vitest";
import { defaultBasisFor, formatQuantity, parseQuantities, primaryQuantity, unitPriceMinor } from "@/lib/quantity";

const q = (text: string) => primaryQuantity(parseQuantities(text));

describe("parseQuantities", () => {
  it.each([
    ["1 kg", "mass", 1_000_000_000 / 1000],
    ["500g", "mass", 500_000],
    ["2 x 500 g", "mass", 1_000_000],
    ["2×1kg (Pack of 2)", "mass", 2_000_000],
    ["500 g (Pack of 3)", "mass", 1_500_000],
    ["2.2 lbs", "mass", Math.round(2.2 * 453_592)],
    ["200 ml", "volume", 200_000],
    ["1 L", "volume", 1_000_000],
    ["Pack of 3 x 200 ml", "volume", 600_000],
    ["12 fl oz", "volume", 12 * 29_574],
    ["60 Tablets", "count", 60_000],
    ["90 Veggie Capsules", "count", 90_000],
    ["60 Tablets (Pack of 2)", "count", 120_000],
  ])("%s → %s", (text, dim, milli) => {
    const r = q(text);
    expect(r?.dimension).toBe(dim);
    expect(r?.totalMilli).toBe(milli);
    expect(r?.confidence).toBe("parsed");
    expect(r?.sourceText).toBe(text);
  });

  it("treats milligrams next to a count as dosage, not net weight", () => {
    const qs = parseQuantities("Vitamin C 1000 mg with Zinc, 60 Tablets");
    expect(qs.find((x) => x.dimension === "mass")).toBeUndefined();
    expect(primaryQuantity(qs)?.totalMilli).toBe(60_000);
  });

  it("prefers net contents over per-serving claims", () => {
    expect(q("25 g Protein per scoop, 1 kg tub")?.totalMilli).toBe(1_000_000);
  });

  it("captures servings separately", () => {
    const qs = parseQuantities("1 kg, 33 Servings");
    expect(qs.find((x) => x.dimension === "serving")?.totalMilli).toBe(33_000);
  });

  it("returns nothing for text without quantities", () => {
    expect(parseQuantities("Wireless Headphones, Graphite")).toEqual([]);
  });
});

describe("unitPriceMinor", () => {
  it("normalizes integer minor units without floating-point drift", () => {
    expect(unitPriceMinor(119_900, q("500 g"), "per_100g")).toBe(23_980); // ₹239.80/100 g
    expect(unitPriceMinor(209_900, q("1 kg"), "per_100g")).toBe(20_990);
    expect(unitPriceMinor(369_900, q("2 kg"), "per_100g")).toBe(18_495);
    expect(unitPriceMinor(64_900, q("60 Tablets"), "per_unit")).toBe(1_082); // ₹10.82 per tablet (half-up)
  });

  it("makes 2 × 500 g and 1 kg comparable", () => {
    expect(unitPriceMinor(200_000, q("2 x 500 g"), "per_kg")).toBe(unitPriceMinor(200_000, q("1 kg"), "per_kg"));
  });

  it("refuses to compare across dimensions", () => {
    expect(unitPriceMinor(64_900, q("60 Tablets"), "per_100g")).toBeNull();
    expect(unitPriceMinor(null, q("1 kg"), "per_100g")).toBeNull();
  });

  it("supports per-pack", () => {
    expect(unitPriceMinor(119_900, q("60 Tablets (Pack of 2)"), "per_pack")).toBe(59_950);
  });

  it("picks sensible defaults and formats", () => {
    expect(defaultBasisFor("mass")).toBe("per_100g");
    expect(defaultBasisFor("count")).toBe("per_unit");
    expect(formatQuantity(q("2 x 500 g"))).toBe("2 × 500 g");
    expect(formatQuantity(q("60 Tablets"))).toBe("60 tablets");
  });
});
