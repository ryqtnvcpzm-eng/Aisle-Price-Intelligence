/**
 * Deterministic price simulator for demo mode.
 *
 * The state of a listing at time t is a pure function of (ASIN, t): we replay
 * 2-hour "epochs" from a fixed origin with a seeded PRNG. That makes demo data
 * reproducible across restarts, lets the seed script and the worker agree on
 * history, and keeps "overnight" activity present whenever you open the app.
 *
 * Every value produced here is SIMULATED and flagged as such downstream.
 */
import { currencyExponent } from "@/lib/money";

export const EPOCH_MS = 2 * 60 * 60 * 1000;
export const ORIGIN = Date.UTC(2025, 6, 1); // 2025-07-01

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stateless PRNG: uniform [0,1) for (seed, epoch, salt). */
export function rand(seed: number, epoch: number, salt: number): number {
  let t = (seed ^ Math.imul(epoch + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface SimState {
  regularMinor: number;
  promo: { priceMinor: number; until: number } | null;
  outOfStockUntil: number | null;
  /** Epoch of the last change to the displayed price. */
  lastChangeEpoch: number;
}

export interface SimPoint {
  at: Date;
  priceMinor: number | null;
  regularMinor: number;
  inStock: boolean;
  onPromo: boolean;
}

/** Charm pricing per currency: ₹1,199 · $19.99 · £32.99. */
export function charm(minor: number, currency: string): number {
  const exp = currencyExponent(currency);
  if (currency === "INR") {
    const rupees = Math.max(49, Math.round(minor / 100 / 50) * 50 - 1);
    return rupees * 100;
  }
  if (exp === 0) return Math.max(1, Math.round(minor / 10) * 10);
  const major = Math.max(1, Math.round(minor / 10 ** exp));
  return major * 10 ** exp - 1;
}

const cache = new Map<string, { epoch: number; state: SimState; points: SimPoint[] }>();

/**
 * Replay the simulation up to `until`. Returns every change point and the
 * final state. Results are memoised per ASIN and extended incrementally.
 */
export function simulate(asin: string, baseMinor: number, currency: string, until: Date): { state: SimState; points: SimPoint[] } {
  const seed = hash32(asin);
  const target = Math.floor((until.getTime() - ORIGIN) / EPOCH_MS);
  let entry = cache.get(asin);
  if (!entry || entry.epoch > target) {
    const initial = charm(baseMinor, currency);
    entry = {
      epoch: 0,
      state: { regularMinor: initial, promo: null, outOfStockUntil: null, lastChangeEpoch: 0 },
      points: [{ at: new Date(ORIGIN), priceMinor: initial, regularMinor: initial, inStock: true, onPromo: false }],
    };
  }
  const s = { ...entry.state };
  const points = entry.points.slice();
  const price = () => (s.outOfStockUntil !== null ? null : (s.promo?.priceMinor ?? s.regularMinor));
  // Competitor brands move a little more often than the volatile-but-stable reference.
  const volatility = 0.8 + rand(seed, 0, 99) * 0.8;

  for (let e = entry.epoch + 1; e <= target; e++) {
    const before = price();
    if (s.outOfStockUntil !== null && e >= s.outOfStockUntil) s.outOfStockUntil = null;
    if (s.promo && e >= s.promo.until) s.promo = null;

    if (s.outOfStockUntil === null && rand(seed, e, 1) < 0.0009 * volatility) {
      s.outOfStockUntil = e + 6 + Math.floor(rand(seed, e, 2) * 18);
    } else if (!s.promo && rand(seed, e, 3) < 0.005 * volatility) {
      const depth = 0.08 + rand(seed, e, 4) * 0.17;
      s.promo = { priceMinor: charm(Math.round(s.regularMinor * (1 - depth)), currency), until: e + 12 + Math.floor(rand(seed, e, 5) * 36) };
    } else if (rand(seed, e, 6) < 0.008 * volatility) {
      const dir = rand(seed, e, 7) < 0.55 ? -1 : 1;
      const mag = 0.02 + rand(seed, e, 8) * 0.05;
      const next = charm(Math.round(s.regularMinor * (1 + dir * mag)), currency);
      const floor = Math.round(baseMinor * 0.8);
      const ceil = Math.round(baseMinor * 1.2);
      s.regularMinor = charm(Math.min(ceil, Math.max(floor, next)), currency);
    }

    const after = price();
    if (after !== before) {
      s.lastChangeEpoch = e;
      points.push({ at: new Date(ORIGIN + e * EPOCH_MS), priceMinor: after, regularMinor: s.regularMinor, inStock: after !== null, onPromo: Boolean(s.promo) });
    }
  }
  cache.set(asin, { epoch: target, state: { ...s }, points });
  return { state: s, points };
}

/** Value in effect at an arbitrary instant (step function over change points). */
export function valueAt(points: SimPoint[], at: Date): SimPoint | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans: SimPoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.at.getTime() <= at.getTime()) {
      ans = points[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
