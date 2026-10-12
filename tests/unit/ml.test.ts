import { describe, expect, it } from "vitest";
import type { Obs } from "@/lib/analytics";
import { detectPromoCycle, detectTrend, detectUnusualMove, segmentBrands, titleSimilarity } from "@/server/ml";

const H = 3_600_000;
const NOW = Date.parse("2026-06-01T00:00:00Z");

/** Hourly observations over `days`, price from fn(dayIndexFromStart). */
function hourly(days: number, fn: (day: number, hour: number) => number | null): Obs[] {
  const out: Obs[] = [];
  for (let h = days * 24; h >= 0; h--) {
    const t = NOW - h * H;
    const idx = days * 24 - h;
    out.push({ t, price: fn(Math.floor(idx / 24), idx) });
  }
  return out;
}

describe("detectUnusualMove (robust z on the listing's own history)", () => {
  // Routine ±5% promo flips every few days, then a sudden −30% cut yesterday.
  const routine = (day: number) => (Math.floor(day / 3) % 2 === 0 ? 1000 : 950);
  it("flags a move far outside the listing's usual swings", () => {
    const pts = hourly(40, (day) => (day >= 39 ? 700 : routine(day)));
    const m = detectUnusualMove(pts, { now: NOW });
    expect(m).not.toBeNull();
    expect(m!.ratio).toBeCloseTo(-0.3, 2);
    expect(m!.z).toBeLessThan(-3.5);
    expect(m!.baselineChanges).toBeGreaterThanOrEqual(6);
  });
  it("stays quiet for a routine promo swing", () => {
    const pts = hourly(40, (day) => routine(day));
    expect(detectUnusualMove(pts, { now: NOW, recentDays: 40 })).toBeNull();
  });
  it("needs enough history before judging", () => {
    const pts = hourly(5, (day) => (day >= 4 ? 700 : 1000));
    expect(detectUnusualMove(pts, { now: NOW })).toBeNull();
  });
});

describe("detectTrend (least squares on daily step samples)", () => {
  it("finds a steady downward drift", () => {
    const pts = hourly(31, (day) => 2000 - Math.floor(day / 4) * 40); // −40 every 4 days ≈ −3.5%/week
    const t = detectTrend(pts, { now: NOW, maxGap: 6 * H });
    expect(t).not.toBeNull();
    expect(t!.weeklyRatio).toBeLessThan(-0.02);
    expect(t!.r2).toBeGreaterThan(0.9);
  });
  it("never calls a single step change a trend", () => {
    const pts = hourly(31, (day) => (day < 15 ? 2000 : 1700));
    expect(detectTrend(pts, { now: NOW, maxGap: 6 * H })).toBeNull();
  });
  it("ignores flat prices", () => {
    expect(detectTrend(hourly(31, () => 999), { now: NOW, maxGap: 6 * H })).toBeNull();
  });
});

describe("detectPromoCycle (autocorrelation of a discount indicator)", () => {
  it("detects discounts that recur every 14 days", () => {
    const pts = hourly(61, (day) => (day % 14 < 3 ? 800 : 1000));
    const c = detectPromoCycle(pts, { now: NOW, maxGap: 6 * H });
    expect(c).not.toBeNull();
    expect(c!.periodDays).toBe(14);
    expect(c!.episodes).toBeGreaterThanOrEqual(3);
    expect(c!.nextEstimate).toBeGreaterThan(c!.lastStart);
  });
  it("finds nothing without repeated dips", () => {
    expect(detectPromoCycle(hourly(61, (day) => (day === 30 ? 800 : 1000)), { now: NOW, maxGap: 6 * H })).toBeNull();
  });
});

describe("segmentBrands (seeded k-means)", () => {
  const brands = [
    { id: "lux1", premium: 0.25, discountedShare: 0.1, movement: 0.01 },
    { id: "lux2", premium: 0.3, discountedShare: 0.05, movement: 0.015 },
    { id: "val1", premium: -0.2, discountedShare: 0.2, movement: 0.02 },
    { id: "val2", premium: -0.25, discountedShare: 0.15, movement: 0.01 },
    { id: "promo1", premium: 0.0, discountedShare: 0.9, movement: 0.12 },
    { id: "promo2", premium: 0.02, discountedShare: 0.85, movement: 0.1 },
  ];
  it("groups brands by positioning and labels the segments", () => {
    const seg = segmentBrands(brands);
    expect(seg.get("lux1")!.cluster).toBe(seg.get("lux2")!.cluster);
    expect(seg.get("val1")!.cluster).toBe(seg.get("val2")!.cluster);
    expect(seg.get("promo1")!.cluster).toBe(seg.get("promo2")!.cluster);
    expect(seg.get("lux1")!.label).toBe("Premium · steady");
    expect(seg.get("val1")!.label).toBe("Value · steady");
    expect(seg.get("promo1")!.label).toBe("Mid-market · promotional");
  });
  it("is deterministic and needs at least four brands", () => {
    expect([...segmentBrands(brands)].map(([id, s]) => [id, s.cluster])).toEqual([...segmentBrands(brands)].map(([id, s]) => [id, s.cluster]));
    expect(segmentBrands(brands.slice(0, 3)).size).toBe(0);
  });
});

describe("titleSimilarity (TF-IDF cosine, brand-agnostic)", () => {
  const sim = titleSimilarity([
    { id: "a", title: "Lumen Nutrition Plant Protein Powder, Pea & Brown Rice, Chocolate", brand: "Lumen Nutrition" },
    { id: "b", title: "Northfield Labs Vegan Protein Powder, Pea + Brown Rice Isolate", brand: "Northfield Labs" },
    { id: "c", title: "Daily Root Women's Multivitamin with Iron, 60 Tablets", brand: "Daily Root" },
  ]);
  it("scores equivalent products from different brands above unrelated ones", () => {
    const ab = sim("a", "b");
    expect(ab.score).toBeGreaterThan(sim("a", "c").score);
    expect(ab.score).toBeGreaterThan(0.2);
    expect(ab.shared).toEqual(expect.arrayContaining(["protein"]));
  });
});
