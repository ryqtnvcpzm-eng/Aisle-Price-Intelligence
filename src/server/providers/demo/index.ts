/**
 * Demo provider — the full DataProvider contract backed by the fictional
 * catalog and deterministic simulator. Lets Aisle run end-to-end with no paid
 * credentials. Every product it returns has `isSimulated: true`.
 *
 * ASINs outside the demo catalog are answered with an honestly-labelled
 * placeholder ("Demo listing · ASIN") rather than invented product details.
 */
import { getMarketplace, type MarketplaceCode } from "@/lib/marketplaces";
import { majorToMinor } from "@/lib/money";
import { recordRequest } from "../accounting";
import {
  emptyBatch,
  ProviderError,
  type DataProvider,
  type FetchOptions,
  type PriceSnapshot,
  type ProductBatch,
  type ProviderProduct,
  type QuotaStatus,
  type SearchResult,
  type VariationFamily,
} from "../types";
import { DEMO_FAMILIES, findDemoFamilyByParent, findDemoListing, type DemoFamily, type DemoVariant } from "./catalog";
import { hash32, simulate, valueAt } from "./simulate";

export function demoImageUrl(asin: string) {
  return `/demo-images/${asin}.svg`;
}

interface Resolved {
  family: DemoFamily | null;
  variant: DemoVariant;
  marketplace: MarketplaceCode;
}

function placeholder(asin: string, marketplace: MarketplaceCode): Resolved {
  const currency = getMarketplace(marketplace).currency;
  const h = hash32(asin);
  const base = currency === "INR" ? 299 + (h % 2700) : currency === "JPY" ? 1500 + (h % 20000) : 9.99 + (h % 120);
  return { family: null, variant: { asin, attributes: {}, sizeText: "", base }, marketplace };
}

function resolve(marketplace: MarketplaceCode, asin: string): Resolved {
  const hit = findDemoListing(asin);
  if (hit && hit.family.marketplace === marketplace) return { family: hit.family, variant: hit.variant, marketplace };
  return placeholder(asin, marketplace);
}

function snapshotAt(r: Resolved, at: Date): PriceSnapshot {
  const currency = getMarketplace(r.marketplace).currency;
  const baseMinor = majorToMinor(r.variant.base, currency);
  const { points, state } = simulate(r.variant.asin, baseMinor, currency, at);
  const point = valueAt(points, at);
  const priceMinor = point?.priceMinor ?? null;
  const seller = r.family?.seller ?? null;
  return {
    observedAt: at,
    currency,
    priceMinor,
    priceBasis: priceMinor === null ? "none" : "buy_box",
    amazonPriceMinor: seller?.isAmazon ? priceMinor : null,
    lowestNewPriceMinor: priceMinor,
    listPriceMinor: r.variant.list ? majorToMinor(r.variant.list, currency) : null,
    dealPriceMinor: point?.onPromo && state.promo && hash32(r.variant.asin) % 3 === 0 ? priceMinor : null,
    primeExclusivePriceMinor: null,
    shippingMinor: priceMinor === null ? null : 0,
    availability: priceMinor === null ? "out_of_stock" : "in_stock",
    seller: seller ? { id: seller.id, name: seller.name, isAmazon: seller.isAmazon } : null,
  };
}

function toProduct(r: Resolved, at: Date): ProviderProduct {
  const f = r.family;
  // Provider "last updated" lags our request by a deterministic 5–55 minutes.
  const lag = (5 + (hash32(`${r.variant.asin}:${Math.floor(at.getTime() / 3_600_000)}`) % 50)) * 60_000;
  return {
    marketplace: r.marketplace,
    asin: r.variant.asin,
    parentAsin: f?.parentAsin ?? null,
    title: f ? `${f.title}${Object.keys(r.variant.attributes).length ? ` — ${Object.values(r.variant.attributes).join(", ")}` : ""}` : `Demo listing · ${r.variant.asin}`,
    brand: f?.brand ?? null,
    imageUrl: demoImageUrl(r.variant.asin),
    categoryPath: f?.category ?? null,
    variationAttributes: Object.keys(r.variant.attributes).length ? r.variant.attributes : null,
    sizeText: r.variant.sizeText || null,
    packageQuantity: null,
    status: "active",
    providerUpdatedAt: new Date(at.getTime() - lag),
    snapshot: snapshotAt(r, at),
    isSimulated: true,
  };
}

export class DemoProvider implements DataProvider {
  readonly id = "demo" as const;
  readonly label = "Demo data (simulated)";
  readonly isSimulated = true;
  readonly capabilities = {
    productDetails: true,
    variations: true,
    currentOffers: true,
    priceHistory: true,
    search: true,
    availability: true,
    providerFreshness: true,
    quota: true,
    monitoring: true,
    maxBatchSize: 100,
  };
  /** Simulated token bucket so budget management can be exercised in demo mode. */
  private tokens = 1200;
  private failNext: { kind: "quota_exhausted" | "upstream" } | null = null;

  constructor(private clock: () => Date = () => new Date()) {}

  supportsMarketplace() {
    return true;
  }

  /** Test hook: make the next request fail, to exercise retry/backoff paths. */
  simulateFailure(kind: "quota_exhausted" | "upstream") {
    this.failNext = { kind };
  }

  async getProducts(marketplace: MarketplaceCode, asins: string[], opts: FetchOptions = {}): Promise<ProductBatch> {
    const started = Date.now();
    if (this.failNext) {
      const kind = this.failNext.kind;
      this.failNext = null;
      await recordRequest({ provider: "demo", operation: "product", marketplace, itemCount: asins.length, status: kind === "quota_exhausted" ? "quota_exhausted" : "error", httpStatus: kind === "quota_exhausted" ? 429 : 500, durationMs: 1, tokensConsumed: 0, tokensLeft: this.tokens, error: "simulated failure" });
      throw new ProviderError(kind, "Simulated provider failure", { provider: "demo", retryAfterMs: 1000 });
    }
    const now = this.clock();
    const batch = emptyBatch();
    batch.requestedAt = now;
    for (const asin of asins) {
      const r = resolve(marketplace, asin);
      batch.products.push(toProduct(r, now));
      batch.variations.set(asin, this.familyFor(r));
      if (opts.history) {
        const currency = getMarketplace(marketplace).currency;
        const { points } = simulate(r.variant.asin, majorToMinor(r.variant.base, currency), currency, now);
        const since = now.getTime() - (opts.historyDays ?? 90) * 86_400_000;
        batch.history.set(
          asin,
          points.filter((p) => p.at.getTime() >= since).map((p) => snapshotAt(r, p.at)),
        );
      }
      if (opts.offers && r.family) {
        const snap = snapshotAt(r, now);
        batch.offers.set(asin, [
          { seller: snap.seller, condition: "new", priceMinor: snap.priceMinor, shippingMinor: 0, currency: snap.currency, isBuyBox: true, isPrime: true, isFba: !r.family.seller.isAmazon },
        ]);
      }
    }
    const cost = asins.length * (opts.history ? 2 : 1);
    this.tokens = Math.max(0, this.tokens - cost);
    batch.tokensConsumed = cost;
    batch.quota = { provider: "demo", tokensLeft: this.tokens, refillRatePerMinute: 20, refillInMs: 60_000, checkedAt: now, note: "Simulated allowance" };
    await recordRequest({ provider: "demo", operation: "product", marketplace, itemCount: asins.length, status: "ok", httpStatus: 200, durationMs: Date.now() - started, tokensConsumed: cost, tokensLeft: this.tokens, error: null });
    return batch;
  }

  private familyFor(r: Resolved): VariationFamily {
    const f = r.family;
    if (!f) {
      return { parentAsin: null, dimensions: [], children: [{ asin: r.variant.asin, attributes: {} }], completeness: "unavailable", note: "Demo mode can't look up real Amazon listings, so variations can't be discovered. Connect Keepa for live data.", reportedTotal: null };
    }
    if (f.variants.length === 1 && !f.parentAsin) {
      return { parentAsin: null, dimensions: [], children: [{ asin: f.variants[0]!.asin, attributes: {} }], completeness: "single", note: "This listing has no variations (simulated).", reportedTotal: 1 };
    }
    const visible = f.partialDiscovery ? f.variants.slice(0, f.variants.length - 1) : f.variants;
    return {
      parentAsin: f.parentAsin,
      dimensions: f.dimensions,
      children: visible.map((x) => ({ asin: x.asin, attributes: x.attributes })),
      completeness: f.partialDiscovery ? "partial" : "complete",
      note: f.partialDiscovery
        ? `The provider reports ${f.variants.length} variations but returned details for ${visible.length} (simulated partial discovery).`
        : `All ${f.variants.length} variations returned by the provider (simulated).`,
      reportedTotal: f.variants.length,
    };
  }

  async getVariations(marketplace: MarketplaceCode, asin: string): Promise<VariationFamily> {
    const parent = findDemoFamilyByParent(asin);
    if (parent) return this.familyFor({ family: parent, variant: parent.variants[0]!, marketplace });
    return this.familyFor(resolve(marketplace, asin));
  }

  async searchProducts(marketplace: MarketplaceCode, term: string): Promise<SearchResult[]> {
    const q = term.toLowerCase();
    return DEMO_FAMILIES.filter((f) => f.marketplace === marketplace && `${f.brand} ${f.title}`.toLowerCase().includes(q)).map((f) => ({
      asin: f.variants[0]!.asin,
      title: f.title,
      brand: f.brand,
      imageUrl: demoImageUrl(f.variants[0]!.asin),
    }));
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    this.tokens = Math.min(1200, this.tokens + 20);
    return { provider: "demo", tokensLeft: this.tokens, refillRatePerMinute: 20, refillInMs: 60_000, checkedAt: this.clock(), note: "Simulated allowance" };
  }

  async diagnose() {
    return { ok: true, message: "Demo mode — all products and prices are simulated." };
  }
}

/** Every simulated listing's full change-point history (used by the seed script). */
export function demoHistory(asin: string, marketplace: MarketplaceCode, until: Date) {
  const r = resolve(marketplace, asin);
  const currency = getMarketplace(marketplace).currency;
  return simulate(asin, majorToMinor(r.variant.base, currency), currency, until).points;
}

export function demoSnapshotAt(asin: string, marketplace: MarketplaceCode, at: Date) {
  return snapshotAt(resolve(marketplace, asin), at);
}

export function demoProductAt(asin: string, marketplace: MarketplaceCode, at: Date) {
  return toProduct(resolve(marketplace, asin), at);
}
