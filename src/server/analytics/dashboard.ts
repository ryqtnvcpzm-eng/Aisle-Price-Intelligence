import "server-only";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { DAY, HOUR, inferMaxGap, priceAt } from "@/lib/analytics";
import { pctChange } from "@/lib/money";
import { listVariantRows, type VariantRow } from "../catalog/queries";
import { db } from "../db/client";
import { activityLogs, alertEvents, alertRules } from "../db/schema";
import { loadSeries } from "./series";

export interface Mover {
  variant: VariantRow;
  from: number;
  to: number;
  ratio: number;
}

export interface Dashboard {
  kpis: {
    products: number;
    variants: number;
    monitored: number;
    competitorBrands: number;
    changes24h: number;
    activeRules: number;
    alerts24h: number;
    freshness: Record<string, number>;
    coverage: number | null;
  };
  movers: { down: Mover[]; up: Mover[] };
  attention: { variant: VariantRow; reason: string }[];
  trend: { t: number; reference: number | null; competitors: number | null }[];
  activity: (typeof activityLogs.$inferSelect)[];
  recentAlerts: (typeof alertEvents.$inferSelect)[];
  brands: { name: string; isReference: boolean; variants: number; avgChange7d: number | null; inStockShare: number }[];
  lastRefreshAt: string | null;
  isSimulated: boolean;
  rows: VariantRow[];
}

export async function getDashboard(workspaceId: string, marketplace: string | null): Promise<Dashboard> {
  const all = (await listVariantRows(workspaceId)).filter((r) => r.tracked && (!marketplace || r.marketplace === marketplace));
  const rows = all.filter((r) => !r.hidden);
  const now = Date.now();
  const listingIds = [...new Set(rows.map((r) => r.listingId))];
  const series = await loadSeries(listingIds, new Date(now - 31 * DAY));

  // Count observed price changes across tracked listings in the last 24h.
  let changes24h = 0;
  for (const id of listingIds) {
    const pts = series.get(id) ?? [];
    for (let i = 1; i < pts.length; i++) if (pts[i]!.t >= now - DAY && pts[i]!.price !== null && pts[i - 1]!.price !== null && pts[i]!.price !== pts[i - 1]!.price) changes24h++;
  }

  const movers: Mover[] = [];
  for (const r of rows) {
    if (r.priceMinor === null || r.p24 === null) continue;
    const ratio = pctChange(r.p24, r.priceMinor);
    if (ratio !== null && ratio !== 0) movers.push({ variant: r, from: r.p24, to: r.priceMinor, ratio });
  }
  movers.sort((a, b) => a.ratio - b.ratio);

  const attention: { variant: VariantRow; reason: string }[] = [];
  for (const r of rows) {
    if (r.freshness === "failed") attention.push({ variant: r, reason: r.lastError ?? "Last refresh failed" });
    else if (r.availability === "out_of_stock") attention.push({ variant: r, reason: "Currently unavailable" });
    else if (r.freshness === "provider_stale") attention.push({ variant: r, reason: "Provider data is older than usual" });
    else if (!r.quantities.length) attention.push({ variant: r, reason: "Quantity unknown — unit price can't be normalized" });
  }

  // Portfolio trend: daily median of price relative to each listing's own price 30 days ago (index = 100).
  const trend: Dashboard["trend"] = [];
  for (let d = 30; d >= 0; d--) {
    const t = now - d * DAY;
    const ratios = { reference: [] as number[], competitors: [] as number[] };
    for (const r of rows) {
      const pts = series.get(r.listingId) ?? [];
      const gap = Math.max(inferMaxGap(pts), 12 * HOUR);
      const base = priceAt(pts, now - 30 * DAY, gap);
      const cur = priceAt(pts, t, gap);
      if (!base.known || !cur.known || !base.price || cur.price === null) continue;
      (r.isReferenceBrand ? ratios.reference : ratios.competitors).push((cur.price / base.price) * 100);
    }
    const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : null);
    trend.push({ t, reference: med(ratios.reference), competitors: med(ratios.competitors) });
  }

  const freshness: Record<string, number> = {};
  for (const r of rows) freshness[r.freshness] = (freshness[r.freshness] ?? 0) + 1;

  const brandMap = new Map<string, { name: string; isReference: boolean; v: VariantRow[] }>();
  for (const r of rows) {
    const k = r.brandName ?? "Unbranded";
    const e = brandMap.get(k) ?? { name: k, isReference: r.isReferenceBrand, v: [] };
    e.v.push(r);
    brandMap.set(k, e);
  }
  const brandStats = [...brandMap.values()].map((b) => {
    const changes = b.v.map((x) => pctChange(x.p7, x.priceMinor)).filter((x): x is number => x !== null);
    return {
      name: b.name,
      isReference: b.isReference,
      variants: b.v.length,
      avgChange7d: changes.length ? changes.reduce((s, x) => s + x, 0) / changes.length : null,
      inStockShare: b.v.filter((x) => x.availability === "in_stock").length / b.v.length,
    };
  });

  const [rulesCount] = await db.select({ n: count() }).from(alertRules).where(and(eq(alertRules.workspaceId, workspaceId), eq(alertRules.paused, false)));
  const [alerts24] = await db.select({ n: count() }).from(alertEvents).where(and(eq(alertEvents.workspaceId, workspaceId), gte(alertEvents.firedAt, new Date(now - DAY))));
  const activity = await db.select().from(activityLogs).where(eq(activityLogs.workspaceId, workspaceId)).orderBy(desc(activityLogs.createdAt)).limit(14);
  const recentAlerts = await db.select().from(alertEvents).where(eq(alertEvents.workspaceId, workspaceId)).orderBy(desc(alertEvents.firedAt)).limit(5);
  const lastRefresh = rows.map((r) => r.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
  const verified = rows.filter((r) => r.freshness === "verified" || r.freshness === "provider_stale").length;

  return {
    kpis: {
      products: new Set(rows.map((r) => r.familyId)).size,
      variants: rows.length,
      monitored: rows.filter((r) => r.checkIntervalMinutes !== null).length,
      competitorBrands: new Set(rows.filter((r) => !r.isReferenceBrand && r.brandName).map((r) => r.brandName)).size,
      changes24h,
      activeRules: Number(rulesCount?.n ?? 0),
      alerts24h: Number(alerts24?.n ?? 0),
      freshness,
      coverage: rows.length ? verified / rows.length : null,
    },
    movers: { down: movers.filter((m) => m.ratio < 0).slice(0, 5), up: movers.filter((m) => m.ratio > 0).reverse().slice(0, 5) },
    attention: attention.slice(0, 8),
    trend,
    activity,
    recentAlerts,
    brands: brandStats.sort((a, b) => Number(b.isReference) - Number(a.isReference) || b.variants - a.variants),
    lastRefreshAt: lastRefresh,
    isSimulated: rows.some((r) => r.isSimulated),
    rows,
  };
}

