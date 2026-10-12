import { describe, expect, it } from "vitest";
import { changeOver, computeStats, DAY, detectEvents, HOUR, priceAt, stepSeries, toIntervals, type Obs } from "@/lib/analytics";

const T = Date.UTC(2026, 0, 1);
const hourly = (prices: (number | null)[], start = T): Obs[] => prices.map((p, i) => ({ t: start + i * HOUR, price: p }));

describe("toIntervals / gap handling", () => {
  it("never bridges a long silence inside dense sampling", () => {
    const pts = [...hourly([100, 100, 100]), { t: T + 20 * HOUR, price: 120 }];
    const ivs = toIntervals(pts, T, T + 21 * HOUR, 6 * HOUR);
    const unknown = ivs.filter((i) => !i.known);
    expect(unknown.length).toBe(1);
    expect(unknown[0]!.from).toBe(T + 2 * HOUR + 6 * HOUR);
    expect(unknown[0]!.to).toBe(T + 20 * HOUR);
  });

  it("keeps sparse-but-regular history continuous (local cadence)", () => {
    const pts: Obs[] = Array.from({ length: 6 }, (_, i) => ({ t: T + i * 12 * HOUR, price: 100 + i }));
    const ivs = toIntervals(pts, T, T + 60 * HOUR, 6 * HOUR);
    expect(ivs.every((i) => i.known)).toBe(true);
  });

  it("step series puts null inside unknown stretches", () => {
    const pts = [...hourly([100, 100]), { t: T + 30 * HOUR, price: 90 }];
    const rows = stepSeries(pts, T, T + 31 * HOUR, 6 * HOUR);
    expect(rows.some((r) => r.price === null && !r.known)).toBe(true);
    expect(rows.at(-1)!.price).toBe(90);
  });
});

describe("computeStats", () => {
  it("time-weights averages over known periods only", () => {
    // 100 for 3h, then 200 for 1h → time-weighted avg 125 (not the naive 150)
    const pts = hourly([100, 100, 100, 200]);
    const s = computeStats(pts, T, T + 4 * HOUR, 6 * HOUR);
    expect(s.timeWeightedAvg).toBeCloseTo(125);
    expect(s.min).toBe(100);
    expect(s.max).toBe(200);
    expect(s.median).toBe(100);
    expect(s.changeCount).toBe(1);
    expect(s.coverage).toBeCloseTo(1);
  });

  it("reports discounted share and out-of-stock share", () => {
    const pts: Obs[] = [
      { t: T, price: 90, list: 100 },
      { t: T + HOUR, price: 100, list: 100 },
      { t: T + 2 * HOUR, price: null },
    ];
    const s = computeStats(pts, T, T + 3 * HOUR, 6 * HOUR);
    expect(s.discountedShare).toBeCloseTo(0.5);
    expect(s.outOfStockShare).toBeCloseTo(1 / 3);
  });

  it("handles empty input", () => {
    const s = computeStats([], T, T + DAY);
    expect(s.min).toBeNull();
    expect(s.coverage).toBe(0);
  });
});

describe("detectEvents", () => {
  it("finds increases, decreases, stock-outs and returns", () => {
    const ev = detectEvents(hourly([100, 90, null, 95, 100]));
    expect(ev.map((e) => e.kind)).toEqual(["decrease", "out_of_stock", "back_in_stock", "increase"]);
    expect(ev[0]!.ratio).toBeCloseTo(-0.1);
  });

  it("labels a rise back to the prevailing price as a return to baseline", () => {
    const pts = [...hourly(Array(48).fill(100)), ...hourly([80, 80, 80, 100], T + 48 * HOUR)];
    const kinds = detectEvents(pts).map((e) => e.kind);
    expect(kinds).toContain("baseline");
  });
});

describe("priceAt / changeOver", () => {
  it("returns unknown when the last reading is too old", () => {
    const pts = hourly([100]);
    expect(priceAt(pts, T + 30 * HOUR, 6 * HOUR)).toEqual({ price: null, known: false });
    expect(priceAt(pts, T + 2 * HOUR, 6 * HOUR)).toEqual({ price: 100, known: true });
  });
  it("computes a 24h change", () => {
    const pts = hourly(Array.from({ length: 30 }, (_, i) => (i < 20 ? 100 : 90)));
    const c = changeOver(pts, T + 29 * HOUR, DAY, 6 * HOUR);
    expect(c?.ratio).toBeCloseTo(-0.1);
  });
});
