import "server-only";
import { and, desc, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { computeStats, DAY, detectEvents, inferMaxGap } from "@/lib/analytics";
import { relativeTime } from "@/lib/freshness";
import { getMarketplace, isMarketplaceCode } from "@/lib/marketplaces";
import { pctChange } from "@/lib/money";
import { formatQuantity, NORMALIZATION_BASES, unitPriceMinor, type NormalizationBasis } from "@/lib/quantity";
import { brandAnalytics } from "../analytics/brands";
import { loadSeries } from "../analytics/series";
import { listVariantRows, type VariantRow } from "../catalog/queries";
import { getGroupDetail } from "../comparison/service";
import { db } from "../db/client";
import { monitoringJobs, providerRequests } from "../db/schema";
import { budgetSummary } from "../monitoring/budget";
import { activeProviderId } from "../providers";
import { HttpError } from "../errors";

export const REPORT_TYPES = {
  competitive_snapshot: { label: "Competitive Pricing Snapshot", needs: "group" },
  brand_comparison: { label: "Brand Comparison", needs: null },
  variant_analysis: { label: "Product Variant Analysis", needs: "family" },
  price_history: { label: "Historical Price Movement", needs: null },
  change_log: { label: "Price Change Log", needs: null },
  portfolio_overview: { label: "Portfolio Overview", needs: null },
  monitoring_health: { label: "Monitoring Health", needs: null },
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export const reportParamsSchema = z.object({
  type: z.enum(Object.keys(REPORT_TYPES) as [ReportType, ...ReportType[]]),
  groupId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  brandNames: z.array(z.string()).max(50).optional(),
  marketplace: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(["csv", "xlsx", "pdf"]).default("xlsx"),
});
export type ReportParams = z.infer<typeof reportParamsSchema>;

export type ColumnKind = "text" | "money" | "pct" | "date" | "number";
export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
  /** For money columns: the row key holding the ISO currency. */
  currencyKey?: string;
  width?: number;
}
export interface ReportSection {
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  bars?: { labelKey: string; valueKey: string; currencyKey?: string };
}
export interface ReportData {
  type: ReportType;
  title: string;
  subtitle: string;
  generatedAt: string;
  dataAsOf: string | null;
  containsSimulated: boolean;
  provider: string;
  filters: string[];
  sections: ReportSection[];
  methodology: string[];
}

const BASE_METHOD = [
  "Prices are integer minor-unit amounts as reported by the data provider; nothing is interpolated or estimated.",
  "Period changes compare the current price with the last observation inside a bounded window before each mark (24h: 24–48h ago; 7d: 7–10 days; 30d: 30–37 days). If no observation exists in that window the change is left blank.",
  "Normalized unit prices use structured pack quantities. Parsed quantities are marked 'parsed' (unverified) unless corrected manually.",
  "Prices in different currencies are never combined; rows outside the group's majority currency are excluded from calculations.",
];

function filterRows(rows: VariantRow[], p: ReportParams) {
  return rows.filter((r) => r.tracked && (!p.marketplace || r.marketplace === p.marketplace) && (!p.brandNames?.length || p.brandNames.includes(r.brandName ?? "Unbranded")));
}

function variantCols(): ReportColumn[] {
  return [
    { key: "brand", label: "Brand", kind: "text", width: 16 },
    { key: "product", label: "Product", kind: "text", width: 36 },
    { key: "variant", label: "Variant", kind: "text", width: 18 },
    { key: "asin", label: "ASIN", kind: "text", width: 12 },
    { key: "marketplace", label: "Marketplace", kind: "text", width: 10 },
    { key: "price", label: "Price", kind: "money", currencyKey: "currency", width: 11 },
    { key: "list", label: "List price", kind: "money", currencyKey: "currency", width: 11 },
    { key: "discount", label: "Discount", kind: "pct", width: 9 },
    { key: "ch24", label: "24h", kind: "pct", width: 8 },
    { key: "ch7", label: "7d", kind: "pct", width: 8 },
    { key: "ch30", label: "30d", kind: "pct", width: 8 },
    { key: "low", label: "Lowest seen", kind: "money", currencyKey: "currency", width: 11 },
    { key: "stock", label: "Stock", kind: "text", width: 11 },
    { key: "observed", label: "Observed at", kind: "date", width: 17 },
    { key: "currency", label: "Currency", kind: "text", width: 8 },
  ];
}

function variantRow(r: VariantRow): Record<string, string | number | null> {
  return {
    brand: r.brandName ?? "—",
    product: r.familyTitle,
    variant: r.label,
    asin: r.asin,
    marketplace: r.marketplace,
    price: r.priceMinor,
    list: r.listPriceMinor,
    discount: r.listPriceMinor && r.priceMinor ? (r.listPriceMinor - r.priceMinor) / r.listPriceMinor : null,
    ch24: pctChange(r.p24, r.priceMinor),
    ch7: pctChange(r.p7, r.priceMinor),
    ch30: pctChange(r.p30, r.priceMinor),
    low: r.lowest,
    stock: r.availability.replace(/_/g, " "),
    observed: r.lastObservedAt,
    currency: r.currency,
  };
}

export async function buildReport(workspaceId: string, p: ReportParams): Promise<ReportData> {
  const now = new Date();
  const to = p.to ? new Date(p.to) : now;
  const from = p.from ? new Date(p.from) : new Date(to.getTime() - 30 * DAY);
  if (from >= to) throw new HttpError(400, "The start date must be before the end date.");
  const allRows = await listVariantRows(workspaceId);
  const rows = filterRows(allRows, p);
  const filters = [
    p.marketplace && isMarketplaceCode(p.marketplace) ? `Marketplace: ${getMarketplace(p.marketplace).name}` : "All marketplaces",
    p.brandNames?.length ? `Brands: ${p.brandNames.join(", ")}` : "All brands",
    `Period: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
  ];
  const dataAsOf = rows.map((r) => r.lastObservedAt).filter(Boolean).sort().at(-1) ?? null;
  const base = { type: p.type, generatedAt: now.toISOString(), dataAsOf, containsSimulated: rows.some((r) => r.isSimulated), provider: activeProviderId(), filters };

  switch (p.type) {
    case "competitive_snapshot": {
      if (!p.groupId) throw new HttpError(400, "Choose a comparison group for this report.");
      const d = await getGroupDetail(workspaceId, p.groupId);
      const basis = d.result.basis as NormalizationBasis;
      const label = NORMALIZATION_BASES[basis].label;
      return {
        ...base,
        containsSimulated: d.items.some((i) => i.isSimulated),
        dataAsOf: d.items.map((i) => i.lastObservedAt).filter(Boolean).sort().at(-1) ?? null,
        title: `Competitive Pricing Snapshot — ${d.group.name}`,
        subtitle: `${d.result.comparableCount} comparable listing(s), normalized ${NORMALIZATION_BASES[basis].long}`,
        filters: [`Comparison group: ${d.group.name}`, `Reference: ${d.referenceBrand?.name ?? "brand marked as reference"}`, `Basis: ${NORMALIZATION_BASES[basis].long}`],
        sections: [
          {
            title: "Findings",
            columns: [{ key: "finding", label: "Finding", kind: "text", width: 120 }],
            rows: d.result.findings.map((f) => ({ finding: f.text })),
          },
          {
            title: "Comparison",
            description: `Ranked by normalized price (${label}). Benchmark = median of comparable competitor listings.`,
            bars: { labelKey: "name", valueKey: "unit", currencyKey: "currency" },
            columns: [
              { key: "rank", label: "Rank", kind: "number", width: 6 },
              { key: "role", label: "Role", kind: "text", width: 11 },
              { key: "name", label: "Listing", kind: "text", width: 32 },
              { key: "quantity", label: "Quantity", kind: "text", width: 14 },
              { key: "price", label: "Price", kind: "money", currencyKey: "currency", width: 11 },
              { key: "unit", label: `Unit price (${label})`, kind: "money", currencyKey: "currency", width: 14 },
              { key: "premium", label: "vs benchmark", kind: "pct", width: 11 },
              { key: "ch7", label: "7d", kind: "pct", width: 8 },
              { key: "stock", label: "Stock", kind: "text", width: 11 },
              { key: "note", label: "Note", kind: "text", width: 30 },
              { key: "currency", label: "Currency", kind: "text", width: 8 },
            ],
            rows: [...d.result.rows]
              .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
              .map((r) => {
                const item = d.items.find((i) => i.variantId === r.id)!;
                return {
                  rank: r.rank,
                  role: r.role,
                  name: `${r.brandName ?? ""} ${r.label}`.trim(),
                  quantity: item.quantities[0] ? `${formatQuantity(item.quantities[0])} (${item.quantities[0].confidence})` : "unknown",
                  price: r.priceMinor,
                  unit: r.unitPriceMinor,
                  premium: r.premium,
                  ch7: pctChange(item.p7, item.priceMinor),
                  stock: r.availability.replace(/_/g, " "),
                  note: r.comparable ? "" : (r.reason ?? "").replace(/_/g, " "),
                  currency: r.currency,
                };
              }),
          },
        ],
        methodology: [...BASE_METHOD, "Suggested (unconfirmed) matches are listed but excluded from every calculation."],
      };
    }
    case "variant_analysis": {
      if (!p.familyId) throw new HttpError(400, "Choose a product for this report.");
      const fam = allRows.filter((r) => r.familyId === p.familyId);
      if (!fam.length) throw new HttpError(404, "Product not found.");
      return {
        ...base,
        containsSimulated: fam.some((r) => r.isSimulated),
        title: `Product Variant Analysis — ${fam[0]!.familyTitle}`,
        subtitle: `${fam.length} tracked variant(s) · discovery ${fam[0]!.discoveryStatus}`,
        sections: [
          {
            title: "Variants",
            columns: [
              { key: "variant", label: "Variant", kind: "text", width: 22 },
              { key: "asin", label: "ASIN", kind: "text", width: 12 },
              { key: "quantity", label: "Quantity", kind: "text", width: 16 },
              { key: "confidence", label: "Qty source", kind: "text", width: 10 },
              { key: "price", label: "Price", kind: "money", currencyKey: "currency", width: 11 },
              { key: "unit", label: "Unit price", kind: "money", currencyKey: "currency", width: 12 },
              { key: "unitBasis", label: "Basis", kind: "text", width: 9 },
              { key: "ch7", label: "7d", kind: "pct", width: 8 },
              { key: "low", label: "Lowest seen", kind: "money", currencyKey: "currency", width: 11 },
              { key: "stock", label: "Stock", kind: "text", width: 11 },
              { key: "currency", label: "Currency", kind: "text", width: 8 },
            ],
            rows: fam.map((r) => {
              const q = r.quantities[0];
              const basis = q ? (({ mass: "per_100g", volume: "per_100ml", count: "per_unit", serving: "per_serving" }) as const)[q.dimension] : null;
              return { variant: r.label, asin: r.asin, quantity: q ? formatQuantity(q) : "unknown", confidence: q?.confidence ?? "—", price: r.priceMinor, unit: basis ? unitPriceMinor(r.priceMinor, r.quantities, basis) : null, unitBasis: basis ? NORMALIZATION_BASES[basis].label : "—", ch7: pctChange(r.p7, r.priceMinor), low: r.lowest, stock: r.availability.replace(/_/g, " "), currency: r.currency };
            }),
          },
        ],
        methodology: BASE_METHOD,
      };
    }
    case "price_history":
    case "change_log": {
      const series = await loadSeries(rows.map((r) => r.listingId), from);
      if (p.type === "price_history") {
        return {
          ...base,
          title: "Historical Price Movement",
          subtitle: `${rows.length} listing(s)`,
          sections: [
            {
              title: "Statistics",
              description: "Time-weighted over known periods only; gaps longer than 3× the usual check interval count as unknown.",
              columns: [
                { key: "name", label: "Listing", kind: "text", width: 34 },
                { key: "min", label: "Min", kind: "money", currencyKey: "currency", width: 10 },
                { key: "max", label: "Max", kind: "money", currencyKey: "currency", width: 10 },
                { key: "median", label: "Median", kind: "money", currencyKey: "currency", width: 10 },
                { key: "avg", label: "Time-weighted avg", kind: "money", currencyKey: "currency", width: 13 },
                { key: "changes", label: "Changes", kind: "number", width: 8 },
                { key: "volatility", label: "Volatility", kind: "pct", width: 9 },
                { key: "discounted", label: "Discounted time", kind: "pct", width: 11 },
                { key: "coverage", label: "Coverage", kind: "pct", width: 9 },
                { key: "lastChange", label: "Last change", kind: "date", width: 17 },
                { key: "currency", label: "Currency", kind: "text", width: 8 },
              ],
              rows: rows.map((r) => {
                const pts = series.get(r.listingId) ?? [];
                const s = computeStats(pts, from.getTime(), to.getTime(), inferMaxGap(pts));
                return { name: `${r.brandName ?? ""} ${r.familyTitle.split(",")[0]} · ${r.label}`.trim(), min: s.min, max: s.max, median: s.median, avg: s.timeWeightedAvg === null ? null : Math.round(s.timeWeightedAvg), changes: s.changeCount, volatility: s.volatility, discounted: s.discountedShare, coverage: s.coverage, lastChange: s.lastChangeAt ? new Date(s.lastChangeAt).toISOString() : null, currency: r.currency };
              }),
            },
          ],
          methodology: BASE_METHOD,
        };
      }
      const log: Record<string, string | number | null>[] = [];
      for (const r of rows) {
        for (const e of detectEvents(series.get(r.listingId) ?? [])) {
          if (e.t < from.getTime() || e.t > to.getTime()) continue;
          log.push({ at: new Date(e.t).toISOString(), name: `${r.brandName ?? ""} ${r.familyTitle.split(",")[0]} · ${r.label}`.trim(), asin: r.asin, event: e.kind.replace(/_/g, " "), from: e.from, to: e.to, change: e.ratio, currency: r.currency });
        }
      }
      log.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return {
        ...base,
        title: "Price Change Log",
        subtitle: `${log.length} observed event(s)`,
        sections: [
          {
            title: "Events",
            columns: [
              { key: "at", label: "Observed at", kind: "date", width: 17 },
              { key: "name", label: "Listing", kind: "text", width: 36 },
              { key: "asin", label: "ASIN", kind: "text", width: 12 },
              { key: "event", label: "Event", kind: "text", width: 14 },
              { key: "from", label: "From", kind: "money", currencyKey: "currency", width: 10 },
              { key: "to", label: "To", kind: "money", currencyKey: "currency", width: 10 },
              { key: "change", label: "Change", kind: "pct", width: 8 },
              { key: "currency", label: "Currency", kind: "text", width: 8 },
            ],
            rows: log,
          },
        ],
        methodology: [...BASE_METHOD, "Events are transitions between consecutive stored observations. Changes that happened and reverted between two checks can't be seen."],
      };
    }
    case "brand_comparison": {
      const stats = (await brandAnalytics(workspaceId)).filter((b) => !p.brandNames?.length || p.brandNames.includes(b.name));
      return {
        ...base,
        title: "Brand Comparison",
        subtitle: `${stats.length} brand(s) across your tracked listings`,
        sections: [
          {
            title: "Brands",
            description: "Statistics cover the listings you track in Aisle — not total market share.",
            columns: [
              { key: "brand", label: "Brand", kind: "text", width: 20 },
              { key: "role", label: "Role", kind: "text", width: 10 },
              { key: "products", label: "Products", kind: "number", width: 9 },
              { key: "variants", label: "Variants", kind: "number", width: 9 },
              { key: "comparable", label: "Comparable listings", kind: "number", width: 12 },
              { key: "premium", label: "Median premium vs others", kind: "pct", width: 14 },
              { key: "lowestShare", label: "Lowest in groups", kind: "pct", width: 12 },
              { key: "discounted", label: "Discounted listings", kind: "pct", width: 12 },
              { key: "inStock", label: "In stock", kind: "pct", width: 9 },
              { key: "ch30", label: "Avg 30d change", kind: "pct", width: 11 },
            ],
            rows: stats.map((b) => ({ brand: b.name, role: b.isReference ? "reference" : "competitor", products: b.families, variants: b.variants, comparable: b.comparableListings, premium: b.medianPremium, lowestShare: b.groupsCompeted ? b.groupsLowest / b.groupsCompeted : null, discounted: b.discountedShare, inStock: b.inStockShare, ch30: b.avgChange30d })),
          },
        ],
        methodology: [...BASE_METHOD, "Premium compares each brand's comparable listings with the median of other brands' listings in the same comparison groups."],
      };
    }
    case "portfolio_overview":
      return {
        ...base,
        title: "Portfolio Overview",
        subtitle: `${new Set(rows.map((r) => r.familyId)).size} product(s), ${rows.length} variant(s)`,
        sections: [{ title: "Tracked listings", columns: variantCols(), rows: rows.map(variantRow) }],
        methodology: BASE_METHOD,
      };
    case "monitoring_health": {
      const jobs = await db.select().from(monitoringJobs).where(and(gte(monitoringJobs.createdAt, from), lte(monitoringJobs.createdAt, to))).orderBy(desc(monitoringJobs.createdAt)).limit(500);
      const relevant = jobs.filter((j) => j.listingIds.some((id) => rows.some((r) => r.listingId === id)));
      const reqs = await db.select().from(providerRequests).where(and(gte(providerRequests.createdAt, from), inArray(providerRequests.status, ["error", "rate_limited", "quota_exhausted", "auth_error", "timeout"]))).limit(200);
      const budget = await budgetSummary(activeProviderId());
      return {
        ...base,
        title: "Monitoring Health",
        subtitle: `${relevant.length} refresh job(s) in period · ${budget.monitoredListings} monitored listing(s)`,
        sections: [
          {
            title: "Listings",
            columns: [
              { key: "name", label: "Listing", kind: "text", width: 36 },
              { key: "freshness", label: "Freshness", kind: "text", width: 16 },
              { key: "interval", label: "Interval (min)", kind: "number", width: 10 },
              { key: "lastSuccess", label: "Last success", kind: "date", width: 17 },
              { key: "providerUpdated", label: "Provider updated", kind: "date", width: 17 },
              { key: "failures", label: "Consecutive failures", kind: "number", width: 10 },
              { key: "error", label: "Last error", kind: "text", width: 30 },
            ],
            rows: rows.map((r) => ({ name: `${r.brandName ?? ""} ${r.label} (${r.asin})`.trim(), freshness: r.freshness.replace(/_/g, " "), interval: r.checkIntervalMinutes, lastSuccess: r.lastSuccessAt, providerUpdated: r.providerUpdatedAt, failures: r.consecutiveFailures, error: r.lastError })),
          },
          {
            title: "Jobs",
            columns: [
              { key: "created", label: "Created", kind: "date", width: 17 },
              { key: "kind", label: "Kind", kind: "text", width: 10 },
              { key: "status", label: "Status", kind: "text", width: 10 },
              { key: "listings", label: "Listings", kind: "number", width: 8 },
              { key: "observations", label: "Observations", kind: "number", width: 10 },
              { key: "tokens", label: "Tokens", kind: "number", width: 8 },
              { key: "error", label: "Error", kind: "text", width: 40 },
            ],
            rows: relevant.map((j) => ({ created: j.createdAt.toISOString(), kind: j.kind, status: j.status, listings: j.listingIds.length, observations: j.observationsWritten, tokens: j.tokensUsed, error: j.error })),
          },
          {
            title: "Provider errors",
            columns: [
              { key: "at", label: "At", kind: "date", width: 17 },
              { key: "provider", label: "Provider", kind: "text", width: 10 },
              { key: "operation", label: "Operation", kind: "text", width: 10 },
              { key: "status", label: "Status", kind: "text", width: 14 },
              { key: "http", label: "HTTP", kind: "number", width: 6 },
              { key: "error", label: "Error", kind: "text", width: 40 },
            ],
            rows: reqs.map((r) => ({ at: r.createdAt.toISOString(), provider: r.provider, operation: r.operation, status: r.status, http: r.httpStatus, error: r.error })),
          },
        ],
        methodology: [
          "Freshness distinguishes our request time, the provider's own last-update time, and the observation timestamp.",
          `Budget: ${budget.tokensUsedMonth} tokens used this month; ~${budget.tokensPerDayEstimate}/day at current schedules. Last data ${relativeTime(dataAsOf)}.`,
        ],
      };
    }
  }
}

