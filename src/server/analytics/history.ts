import "server-only";
import { computeStats, detectEvents, inferMaxGap, stepSeries, type PriceEvent, type PriceStats } from "@/lib/analytics";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { listVariantRows } from "../catalog/queries";
import { db } from "../db/client";
import { priceObservations } from "../db/schema";
import { loadSeries } from "./series";

/** A price the owner captured from the Amazon.in page with the bookmarklet. Never part of the monitored line. */
export interface CapturePoint {
  t: number;
  price: number | null;
  isDeal: boolean;
  availability: string;
}

export interface HistorySeries {
  variantId: string;
  familyId: string;
  name: string;
  brandName: string | null;
  label: string;
  isReference: boolean;
  currency: string | null;
  isSimulated: boolean;
  points: { t: number; price: number | null; known: boolean }[];
  raw: { t: number; price: number | null }[];
  captures: CapturePoint[];
  events: PriceEvent[];
  stats: PriceStats;
  maxGapMs: number;
}

/** Chart-ready, gap-aware series for the given variants and window. */
export async function getHistory(workspaceId: string, variantIds: string[], from: Date, to: Date): Promise<HistorySeries[]> {
  const rows = await listVariantRows(workspaceId, { variantIds, includeArchived: true });
  const listingIds = rows.map((r) => r.listingId);
  const [series, captured] = await Promise.all([loadSeries(listingIds, from), loadCaptures(listingIds, from, to)]);
  return rows.map((r) => {
    const pts = series.get(r.listingId) ?? [];
    const gap = inferMaxGap(pts);
    return {
      variantId: r.variantId,
      familyId: r.familyId,
      name: `${r.brandName ? `${r.brandName} · ` : ""}${r.label}`,
      brandName: r.brandName,
      label: r.label,
      isReference: r.isReferenceBrand,
      currency: r.currency,
      isSimulated: r.isSimulated,
      points: stepSeries(pts, from.getTime(), to.getTime(), gap),
      raw: pts.filter((p) => p.t >= from.getTime() && p.t <= to.getTime()).map((p) => ({ t: p.t, price: p.price })),
      captures: captured.get(r.listingId) ?? [],
      events: detectEvents(pts).filter((e) => e.t >= from.getTime() && e.t <= to.getTime()),
      stats: computeStats(pts, from.getTime(), to.getTime(), gap),
      maxGapMs: gap,
    };
  });
}

async function loadCaptures(listingIds: string[], from: Date, to: Date) {
  const out = new Map<string, CapturePoint[]>();
  if (!listingIds.length) return out;
  const rows = await db
    .select({ listingId: priceObservations.listingId, t: priceObservations.observedAt, price: priceObservations.priceMinor, deal: priceObservations.dealPriceMinor, availability: priceObservations.availability })
    .from(priceObservations)
    .where(and(inArray(priceObservations.listingId, listingIds), eq(priceObservations.source, "user-capture"), gte(priceObservations.observedAt, from), lte(priceObservations.observedAt, to)))
    .orderBy(asc(priceObservations.observedAt));
  for (const r of rows) {
    const list = out.get(r.listingId) ?? [];
    list.push({ t: r.t.getTime(), price: r.price, isDeal: r.deal !== null, availability: r.availability });
    out.set(r.listingId, list);
  }
  return out;
}
