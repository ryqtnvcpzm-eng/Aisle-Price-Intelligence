import { describe, expect, it } from "vitest";
import { divRound, formatMoney, formatPct, majorToMinor, medianMinor, pctChange } from "@/lib/money";

describe("money", () => {
  it("formats per currency conventions with no float sums", () => {
    expect(formatMoney(119_900, "INR")).toBe("₹1,199");
    expect(formatMoney(12_345_678, "INR")).toBe("₹1,23,456.78");
    expect(formatMoney(19_999, "USD")).toBe("$199.99");
    expect(formatMoney(3_299, "GBP")).toBe("£32.99");
    expect(formatMoney(1_500, "JPY")).toBe("￥1,500");
    expect(formatMoney(null, "INR")).toBe("—");
  });
  it("converts major to minor with currency exponents", () => {
    expect(majorToMinor(2099, "INR")).toBe(209_900);
    expect(majorToMinor(19.99, "USD")).toBe(1_999);
    expect(majorToMinor(1500, "JPY")).toBe(1_500);
  });
  it("rounds half-up in integer space", () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(7n, 3n)).toBe(2n);
  });
  it("computes medians and changes", () => {
    expect(medianMinor([300, 100, 200])).toBe(200);
    expect(medianMinor([100, 201])).toBe(151);
    expect(medianMinor([])).toBeNull();
    expect(pctChange(100, 95)).toBeCloseTo(-0.05);
    expect(pctChange(0, 5)).toBeNull();
    expect(formatPct(-0.052, { signed: true })).toBe("−5.2%");
    expect(formatPct(0.12)).toBe("12%");
  });
});
