import "server-only";
import { computeStats, detectEvents, inferMaxGap, stepSeries, type PriceEvent, type PriceStats } from "@/lib/analytics";
import { listVariantRows } from "../catalog/queries";
import { loadSeries } from "./series";

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
  events: PriceEvent[];
  stats: PriceStats;
  maxGapMs: number;
}

/** Chart-ready, gap-aware series for the given variants and window. */
export async function getHistory(workspaceId: string, variantIds: string[], from: Date, to: Date): Promise<HistorySeries[]> {
  const rows = await listVariantRows(workspaceId, { variantIds, includeArchived: true });
  const series = await loadSeries(rows.map((r) => r.listingId), from);
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
      events: detectEvents(pts).filter((e) => e.t >= from.getTime() && e.t <= to.getTime()),
      stats: computeStats(pts, from.getTime(), to.getTime(), gap),
      maxGapMs: gap,
    };
  });
}
