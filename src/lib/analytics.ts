/**
 * Time-series analytics over irregularly-sampled price observations.
 *
 * Model: each observation's price is known to hold from its timestamp until
 * the next observation — but only up to `maxGapMs`. Beyond that we don't know
 * what happened, so that stretch is *unknown* time: excluded from time-weighted
 * statistics and rendered as a gap in charts. We never interpolate prices.
 */

export interface Obs {
  t: number; // epoch ms
  price: number | null; // minor units; null = no offer / out of stock
  list?: number | null;
  deal?: number | null;
  inStock?: boolean;
  sellerId?: string | null;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Default: a reading stays trustworthy for 6h, or 3× the observed median cadence if slower. */
export function inferMaxGap(points: Obs[], floorMs = 6 * HOUR): number {
  if (points.length < 3) return Math.max(floorMs, 26 * HOUR);
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) deltas.push(points[i]!.t - points[i - 1]!.t);
  deltas.sort((a, b) => a - b);
  const med = deltas[Math.floor(deltas.length / 2)]!;
  return Math.max(floorMs, med * 3);
}

export interface Interval {
  from: number;
  to: number;
  price: number | null;
  list: number | null | undefined;
  deal: number | null | undefined;
  known: boolean;
}

/** Convert points into contiguous step intervals clipped to [start, end]. */
export function toIntervals(points: Obs[], start: number, end: number, maxGapMs: number): Interval[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Interval[] = [];
  // Carry in the last observation before the window, if it's recent enough.
  let prev: Obs | undefined;
  for (const p of sorted) {
    if (p.t <= start) prev = p;
    else break;
  }
  const inWindow = sorted.filter((p) => p.t > start && p.t <= end);
  const seq = prev ? [prev, ...inWindow] : inWindow;
  for (let i = 0; i < seq.length; i++) {
    const p = seq[i]!;
    const next = seq[i + 1];
    const prevT = seq[i - 1]?.t;
    const from = Math.max(p.t, start);
    const naturalEnd = next ? next.t : end;
    // Trust a reading for the larger of the global threshold and 2.5× the cadence
    // at which this listing was being sampled (capped at 3 days). Sparse historical
    // sampling stays continuous; a missed check inside dense sampling shows as a gap.
    // First point: borrow the cadence of the following pair, if any.
    const afterNext = seq[i + 2]?.t;
    const localCadence = prevT !== undefined ? p.t - prevT : next && afterNext !== undefined ? afterNext - next.t : 0;
    const trust = Math.min(3 * DAY, Math.max(maxGapMs, localCadence * 2.5));
    const knownUntil = Math.min(naturalEnd, p.t + trust, end);
    if (knownUntil > from) out.push({ from, to: knownUntil, price: p.price, list: p.list, deal: p.deal, known: true });
    if (naturalEnd > knownUntil && knownUntil < end) out.push({ from: Math.max(knownUntil, start), to: Math.min(naturalEnd, end), price: null, list: null, deal: null, known: false });
  }
  return out.filter((iv) => iv.to > iv.from);
}

export interface PriceStats {
  min: number | null;
  max: number | null;
  median: number | null;
  timeWeightedAvg: number | null;
  first: number | null;
  last: number | null;
  changeCount: number;
  /** Std-dev of relative change sizes, a scale-free volatility measure. */
  volatility: number | null;
  /** Share of *known, in-stock* time where price was below list or a deal applied. */
  discountedShare: number | null;
  /** Share of the window for which we have trustworthy readings. */
  coverage: number;
  outOfStockShare: number | null;
  lastChangeAt: number | null;
  /** Least-squares slope over time-weighted daily values, as ratio per 30 days. */
  trend30d: number | null;
  observations: number;
}

export function computeStats(points: Obs[], start: number, end: number, maxGapMs = inferMaxGap(points)): PriceStats {
  const ivs = toIntervals(points, start, end, maxGapMs);
  const span = end - start;
  const known = ivs.filter((i) => i.known);
  const knownMs = known.reduce((s, i) => s + (i.to - i.from), 0);
  const priced = known.filter((i) => i.price !== null);
  const pricedMs = priced.reduce((s, i) => s + (i.to - i.from), 0);
  const values = priced.map((i) => i.price!) as number[];
  const sorted = [...values].sort((a, b) => a - b);

  // Time-weighted median: walk sorted by price until half the priced time is covered.
  let median: number | null = null;
  if (priced.length) {
    const byPrice = [...priced].sort((a, b) => a.price! - b.price!);
    let acc = 0;
    for (const iv of byPrice) {
      acc += iv.to - iv.from;
      if (acc >= pricedMs / 2) {
        median = iv.price!;
        break;
      }
    }
  }

  const twa = pricedMs > 0 ? priced.reduce((s, i) => s + i.price! * (i.to - i.from), 0) / pricedMs : null;

  const inWindow = points.filter((p) => p.t >= start && p.t <= end).sort((a, b) => a.t - b.t);
  let changeCount = 0;
  let lastChangeAt: number | null = null;
  const rel: number[] = [];
  const ordered = [...points].sort((a, b) => a.t - b.t);
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    if (a.price !== null && b.price !== null && a.price !== b.price) {
      lastChangeAt = b.t;
      if (b.t >= start && b.t <= end) {
        changeCount++;
        rel.push((b.price - a.price) / a.price);
      }
    }
  }
  let volatility: number | null = null;
  if (rel.length >= 2) {
    const mean = rel.reduce((s, x) => s + x, 0) / rel.length;
    volatility = Math.sqrt(rel.reduce((s, x) => s + (x - mean) ** 2, 0) / (rel.length - 1));
  } else if (rel.length === 1) volatility = Math.abs(rel[0]!);
  else if (priced.length) volatility = 0;

  const discountedMs = priced.filter((i) => (i.list != null && i.price! < i.list) || (i.deal != null && i.deal > 0)).reduce((s, i) => s + (i.to - i.from), 0);
  const oosMs = known.filter((i) => i.price === null).reduce((s, i) => s + (i.to - i.from), 0);

  // Trend: regress daily time-weighted means.
  let trend30d: number | null = null;
  const days = new Map<number, { sum: number; ms: number }>();
  for (const iv of priced) {
    for (let d = Math.floor(iv.from / DAY); d <= Math.floor((iv.to - 1) / DAY); d++) {
      const a = Math.max(iv.from, d * DAY);
      const b = Math.min(iv.to, (d + 1) * DAY);
      if (b <= a) continue;
      const cur = days.get(d) ?? { sum: 0, ms: 0 };
      cur.sum += iv.price! * (b - a);
      cur.ms += b - a;
      days.set(d, cur);
    }
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, v] of days) if (v.ms > HOUR) {
    xs.push(d);
    ys.push(v.sum / v.ms);
  }
  if (xs.length >= 3 && twa) {
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const my = ys.reduce((s, y) => s + y, 0) / ys.length;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    if (den > 0) trend30d = ((num / den) * 30) / twa;
  }

  return {
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    median,
    timeWeightedAvg: twa,
    first: priced[0]?.price ?? null,
    last: priced.at(-1)?.price ?? null,
    changeCount,
    volatility,
    discountedShare: pricedMs > 0 ? discountedMs / pricedMs : null,
    coverage: span > 0 ? knownMs / span : 0,
    outOfStockShare: knownMs > 0 ? oosMs / knownMs : null,
    lastChangeAt,
    trend30d,
    observations: inWindow.length,
  };
}

/** Price in effect at time t, or null if unknown (no reading within maxGap). */
export function priceAt(points: Obs[], t: number, maxGapMs: number): { price: number | null; known: boolean } {
  let best: Obs | null = null;
  for (const p of points) {
    if (p.t <= t && (!best || p.t > best.t)) best = p;
  }
  if (!best || t - best.t > maxGapMs) return { price: null, known: false };
  return { price: best.price, known: true };
}

export function changeOver(points: Obs[], now: number, windowMs: number, maxGapMs = inferMaxGap(points)) {
  const then = priceAt(points, now - windowMs, Math.max(maxGapMs, windowMs * 0.25));
  const cur = priceAt(points, now, Math.max(maxGapMs, 48 * HOUR));
  if (!then.known || !cur.known || then.price === null || cur.price === null) return null;
  return { from: then.price, to: cur.price, delta: cur.price - then.price, ratio: (cur.price - then.price) / then.price };
}

// ─── Events ─────────────────────────────────────────────────────────────────

export type PriceEventKind = "increase" | "decrease" | "baseline" | "out_of_stock" | "back_in_stock" | "discount_started" | "discount_ended" | "seller_change";

export interface PriceEvent {
  t: number;
  kind: PriceEventKind;
  from: number | null;
  to: number | null;
  ratio: number | null;
}

/**
 * Detect events between consecutive observations. Only transitions that the
 * observations directly show are reported — nothing inferred inside gaps.
 */
export function detectEvents(points: Obs[], opts: { minRatio?: number; baselineWindowMs?: number } = {}): PriceEvent[] {
  const minRatio = opts.minRatio ?? 0.005;
  const baselineWindow = opts.baselineWindowMs ?? 14 * DAY;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const events: PriceEvent[] = [];
  let lastPriced: Obs | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (a.price !== null) lastPriced = a;
    if (a.price !== null && b.price === null) events.push({ t: b.t, kind: "out_of_stock", from: a.price, to: null, ratio: null });
    else if (a.price === null && b.price !== null) {
      events.push({ t: b.t, kind: "back_in_stock", from: lastPriced?.price ?? null, to: b.price, ratio: lastPriced?.price ? (b.price - lastPriced.price) / lastPriced.price : null });
    } else if (a.price !== null && b.price !== null && a.price !== b.price) {
      const ratio = (b.price - a.price) / a.price;
      if (Math.abs(ratio) >= minRatio) {
        // "Returned to baseline": the new price equals the most common price of the prior window.
        const window = sorted.filter((p) => p.t < b.t && p.t >= b.t - baselineWindow && p.price !== null);
        const counts = new Map<number, number>();
        for (let j = 0; j < window.length; j++) {
          const w = window[j]!;
          const dur = (window[j + 1]?.t ?? b.t) - w.t;
          counts.set(w.price!, (counts.get(w.price!) ?? 0) + dur);
        }
        const mode = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
        const isBaseline = mode !== undefined && b.price === mode && a.price !== mode && ratio > 0;
        events.push({ t: b.t, kind: isBaseline ? "baseline" : ratio > 0 ? "increase" : "decrease", from: a.price, to: b.price, ratio });
      }
    }
    const aDisc = a.deal != null || (a.list != null && a.price != null && a.price < a.list * 0.97);
    const bDisc = b.deal != null || (b.list != null && b.price != null && b.price < b.list * 0.97);
    if (a.deal == null && b.deal != null) events.push({ t: b.t, kind: "discount_started", from: a.price, to: b.price, ratio: null });
    else if (a.deal != null && b.deal == null && aDisc && !bDisc) events.push({ t: b.t, kind: "discount_ended", from: a.price, to: b.price, ratio: null });
    if (a.sellerId && b.sellerId && a.sellerId !== b.sellerId) events.push({ t: b.t, kind: "seller_change", from: a.price, to: b.price, ratio: null });
  }
  return events;
}

/**
 * Chart geometry: step series with explicit breaks. Returns rows where `price`
 * is null inside unknown stretches so the chart draws a gap, never a slope.
 */
export function stepSeries(points: Obs[], start: number, end: number, maxGapMs = inferMaxGap(points)) {
  const rows: { t: number; price: number | null; known: boolean }[] = [];
  for (const iv of toIntervals(points, start, end, maxGapMs)) {
    rows.push({ t: iv.from, price: iv.known ? iv.price : null, known: iv.known });
  }
  const lastIv = rows.at(-1);
  if (lastIv) rows.push({ t: end, price: lastIv.price, known: lastIv.known });
  return rows;
}
