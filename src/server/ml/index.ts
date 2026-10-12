/**
 * Free, local machine learning for price intelligence. Everything here runs
 * in-process on plain JavaScript (no paid APIs, no model downloads), so it
 * works on free hosting and inside the scheduled worker alike.
 *
 *  - simple-statistics: robust anomaly scores (median / MAD) and trend
 *    regression with goodness of fit.
 *  - ml-kmeans: brand positioning segments (seeded, so results are stable).
 *  - tiny-tfidf: TF-IDF title similarity for "comparable product" suggestions.
 *
 * Models only describe stored observations. Outputs carry the evidence they
 * were computed from and never assert why a price moved.
 */
import { kmeans } from "ml-kmeans";
import { linearRegression, linearRegressionLine, mean, median, medianAbsoluteDeviation, rSquared, sampleCorrelation, standardDeviation } from "simple-statistics";
import { Corpus, Similarity } from "tiny-tfidf";
import { DAY, priceAt, type Obs } from "@/lib/analytics";

/* ───────────────────────────── Anomaly detection ───────────────────────────── */

export interface UnusualMove {
  /** Robust z-score of the latest change against this listing's own change history. */
  z: number;
  /** Relative change of the latest move, e.g. -0.18. */
  ratio: number;
  from: number;
  to: number;
  at: number;
  /** Number of earlier changes the baseline was learned from. */
  baselineChanges: number;
  typicalAbsRatio: number;
}

/** Consistency constant that makes MAD comparable to a standard deviation for normal data. */
const MAD_SCALE = 1.4826;

/**
 * Is the most recent price change unusual for this listing? Learns the
 * distribution of its own past log-returns and scores the latest one with a
 * robust z (median/MAD), so routine promo swings don't trigger it.
 */
export function detectUnusualMove(points: Obs[], opts: { now: number; recentDays?: number; minHistory?: number; threshold?: number }): UnusualMove | null {
  const { now, recentDays = 3, minHistory = 6, threshold = 3.5 } = opts;
  const changes: { t: number; from: number; to: number; r: number }[] = [];
  let prev: Obs | null = null;
  for (const p of points) {
    if (p.price === null) continue;
    if (prev && prev.price !== null && p.price !== prev.price && prev.price > 0) changes.push({ t: p.t, from: prev.price, to: p.price, r: Math.log(p.price / prev.price) });
    prev = p;
  }
  const latest = changes.at(-1);
  if (!latest || latest.t < now - recentDays * DAY) return null;
  const history = changes.slice(0, -1).map((c) => c.r);
  if (history.length < minHistory) return null;
  const center = median(history);
  // Floor the spread at 0.5% so a perfectly regular history doesn't turn tiny moves into infinite scores.
  const spread = Math.max(MAD_SCALE * medianAbsoluteDeviation(history), 0.005);
  const z = (latest.r - center) / spread;
  if (Math.abs(z) < threshold) return null;
  return {
    z: Math.round(z * 10) / 10,
    ratio: latest.to / latest.from - 1,
    from: latest.from,
    to: latest.to,
    at: latest.t,
    baselineChanges: history.length,
    typicalAbsRatio: Math.exp(median(history.map(Math.abs))) - 1,
  };
}

/* ─────────────────────────────── Trend regression ─────────────────────────────── */

/** Daily step-function samples (never interpolated): the price in effect at each day's mark. */
export function dailySamples(points: Obs[], now: number, days: number, maxGap: number): { x: number; y: number | null }[] {
  const out: { x: number; y: number | null }[] = [];
  for (let k = days; k >= 0; k--) {
    const at = priceAt(points, now - k * DAY, maxGap);
    out.push({ x: days - k, y: at.known ? at.price : null });
  }
  return out;
}

export interface PriceTrend {
  /** Fitted change per week relative to the window's mean price, e.g. -0.012 = −1.2%/week. */
  weeklyRatio: number;
  r2: number;
  days: number;
  samples: number;
  changes: number;
  fittedStart: number;
  fittedEnd: number;
}

/**
 * Least-squares trend over daily samples. Reported only when the line
 * genuinely explains the data (R² ≥ 0.7) and is built from several distinct
 * moves, so a single step change is never presented as a "trend".
 */
export function detectTrend(points: Obs[], opts: { now: number; days?: number; maxGap: number; minWeekly?: number; minR2?: number; minChanges?: number }): PriceTrend | null {
  const { now, days = 30, maxGap, minWeekly = 0.01, minR2 = 0.7, minChanges = 3 } = opts;
  const known = dailySamples(points, now, days, maxGap).filter((s): s is { x: number; y: number } => s.y !== null);
  if (known.length < days * 0.8) return null;
  let changes = 0;
  for (let i = 1; i < known.length; i++) if (known[i]!.y !== known[i - 1]!.y) changes++;
  if (changes < minChanges || new Set(known.map((s) => s.y)).size < 3) return null;
  const data = known.map((s) => [s.x, s.y]);
  const fit = linearRegression(data);
  const r2 = rSquared(data, linearRegressionLine(fit));
  const avg = mean(known.map((s) => s.y));
  if (!avg || !Number.isFinite(r2)) return null;
  const weeklyRatio = (fit.m * 7) / avg;
  if (r2 < minR2 || Math.abs(weeklyRatio) < minWeekly) return null;
  return {
    weeklyRatio,
    r2: Math.round(r2 * 100) / 100,
    days,
    samples: known.length,
    changes,
    fittedStart: Math.round(fit.b),
    fittedEnd: Math.round(fit.m * days + fit.b),
  };
}

/* ───────────────────────────── Promotion cycles ───────────────────────────── */

export interface PromoCycle {
  periodDays: number;
  /** Autocorrelation of the discount indicator at the detected lag. */
  acf: number;
  episodes: number;
  lastStart: number;
  /** Pattern-based estimate (not a prediction): last start + period. */
  nextEstimate: number;
}

/**
 * Do discounts recur on a schedule? Builds a daily "discounted vs. trailing
 * 14-day median" indicator and looks for a strong autocorrelation peak.
 */
export function detectPromoCycle(points: Obs[], opts: { now: number; days?: number; maxGap: number; dip?: number; minLag?: number; maxLag?: number }): PromoCycle | null {
  const { now, days = 60, maxGap, dip = 0.08, minLag = 7, maxLag = 25 } = opts;
  const samples = dailySamples(points, now, days, maxGap);
  if (samples.filter((s) => s.y !== null).length < days * 0.8) return null;
  const ind: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const window = samples.slice(Math.max(0, i - 14), i + 1).map((s) => s.y).filter((y): y is number => y !== null);
    const y = samples[i]!.y;
    ind.push(y !== null && window.length >= 5 && y < median(window) * (1 - dip) ? 1 : 0);
  }
  const starts: number[] = [];
  for (let i = 1; i < ind.length; i++) if (ind[i] === 1 && ind[i - 1] === 0) starts.push(i);
  if (starts.length < 3) return null;
  let best = { lag: 0, acf: -1 };
  for (let lag = minLag; lag <= Math.min(maxLag, Math.floor(ind.length / 2)); lag++) {
    const a = ind.slice(0, ind.length - lag);
    const b = ind.slice(lag);
    if (standardDeviation(a) === 0 || standardDeviation(b) === 0) continue;
    const r = sampleCorrelation(a, b);
    if (r > best.acf) best = { lag, acf: r };
  }
  if (best.acf < 0.5) return null;
  const spacing = median(starts.slice(1).map((s, i) => s - starts[i]!));
  if (Math.abs(spacing - best.lag) > 3) return null;
  const lastStart = now - (ind.length - 1 - starts.at(-1)!) * DAY;
  return { periodDays: best.lag, acf: Math.round(best.acf * 100) / 100, episodes: starts.length, lastStart, nextEstimate: lastStart + best.lag * DAY };
}

/* ───────────────────────────── Brand segmentation ───────────────────────────── */

export interface BrandFeatures {
  id: string;
  /** Median unit-price premium vs. other brands (e.g. 0.12 = 12% pricier). */
  premium: number;
  /** Share of listings currently below list price. */
  discountedShare: number;
  /** Mean absolute 30-day price change. */
  movement: number;
}

export interface BrandSegment {
  cluster: number;
  label: string;
  /** Members' mean features, in original units. */
  centroid: { premium: number; discountedShare: number; movement: number };
}

function zscores(values: number[]): number[] {
  const m = mean(values);
  const sd = values.length > 1 ? standardDeviation(values) : 0;
  return values.map((v) => (sd > 0 ? (v - m) / sd : 0));
}

/**
 * k-means on standardized features (k ≤ 3 and ≤ n/2 so every segment can hold
 * at least two brands; seeded k-means++ so the same data always gives the same
 * segments). Clusters that describe the same position are merged. Needs at
 * least four brands to be meaningful.
 */
export function segmentBrands(brands: BrandFeatures[], opts: { k?: number; seed?: number } = {}): Map<string, BrandSegment> {
  const out = new Map<string, BrandSegment>();
  if (brands.length < 4) return out;
  const k = Math.min(opts.k ?? 3, Math.floor(brands.length / 2));
  // Price level is the primary positioning axis, so it carries double weight in the feature space.
  const cols = [zscores(brands.map((b) => b.premium)).map((z) => z * 2), zscores(brands.map((b) => b.discountedShare)), zscores(brands.map((b) => b.movement))];
  const data = brands.map((_, i) => cols.map((c) => c[i]!));
  const result = kmeans(data, k, { initialization: "kmeans++", seed: opts.seed ?? 42, maxIterations: 100 });
  const movementMedian = median(brands.map((b) => b.movement));
  const discountMedian = median(brands.map((b) => b.discountedShare));
  const centroidOf = (members: BrandFeatures[]) => ({ premium: mean(members.map((m) => m.premium)), discountedShare: mean(members.map((m) => m.discountedShare)), movement: mean(members.map((m) => m.movement)) });
  const labelOf = (c: BrandSegment["centroid"]) => {
    const tier = c.premium >= 0.05 ? "Premium" : c.premium <= -0.05 ? "Value" : "Mid-market";
    const style = c.movement > movementMedian * 1.25 || c.discountedShare > Math.max(0.5, discountMedian * 1.25) ? "promotional" : "steady";
    return `${tier} · ${style}`;
  };
  // Label each k-means cluster, then merge clusters that land on the same description.
  const byLabel = new Map<string, BrandFeatures[]>();
  for (let c = 0; c < k; c++) {
    const members = brands.filter((_, i) => result.clusters[i] === c);
    if (!members.length) continue;
    const label = labelOf(centroidOf(members));
    byLabel.set(label, [...(byLabel.get(label) ?? []), ...members]);
  }
  [...byLabel.entries()].forEach(([label, members], cluster) => {
    const centroid = centroidOf(members);
    for (const m of members) out.set(m.id, { cluster, label, centroid });
  });
  return out;
}

/* ───────────────────────────── Title similarity ───────────────────────────── */

/**
 * TF-IDF cosine similarity between product titles. Brand names are removed
 * first so cross-brand equivalents ("Vegan Protein, Chocolate, 1 kg") match on
 * what the product is, not who makes it.
 */
export function titleSimilarity(docs: { id: string; title: string; brand?: string | null }[]): (a: string, b: string) => { score: number; shared: string[] } {
  const clean = (d: (typeof docs)[number]) => {
    let t = d.title;
    if (d.brand) for (const word of d.brand.split(/\s+/).filter(Boolean)) t = t.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
    return t;
  };
  const unique = [...new Map(docs.map((d) => [d.id, d])).values()];
  if (unique.length < 2) return () => ({ score: 0, shared: [] });
  const corpus = new Corpus(unique.map((d) => d.id), unique.map(clean));
  const vectors = new Map<string, Map<string, number>>();
  const vec = (id: string) => {
    let v = vectors.get(id);
    if (!v) vectors.set(id, (v = corpus.getDocumentVector(id)));
    return v;
  };
  return (a, b) => {
    if (!vectors.has(a) && !unique.some((d) => d.id === a)) return { score: 0, shared: [] };
    if (!vectors.has(b) && !unique.some((d) => d.id === b)) return { score: 0, shared: [] };
    const score = Similarity.cosineSimilarity(vec(a), vec(b));
    const shared = corpus.getCommonTerms(a, b, 4).map((t) => t[0]);
    return { score: Number.isFinite(score) ? Math.round(score * 100) / 100 : 0, shared };
  };
}
