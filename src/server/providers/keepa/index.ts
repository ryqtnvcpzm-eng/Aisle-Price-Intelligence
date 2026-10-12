/**
 * Keepa adapter — primary real-data provider.
 *
 * Supports: product details, variations, current prices (Amazon / New / Buy Box /
 * list / lightning deal / Prime exclusive), price history, provider freshness
 * (`lastUpdate`) and token quota. Batches up to 100 ASINs per request.
 * Marketplaces: those with a `keepaDomainId` in the registry.
 */
import { getMarketplace, type MarketplaceCode } from "@/lib/marketplaces";
import { recordRequest } from "../accounting";
import {
  emptyBatch,
  ProviderError,
  type DataProvider,
  type FetchOptions,
  type ProductBatch,
  type QuotaStatus,
  type SearchResult,
  type VariationFamily,
} from "../types";
import { historyFor, imageUrlFor, mapProduct, variationFamilyFor, type KeepaProductResponse } from "./parse";

const BASE = "https://api.keepa.com";
const TIMEOUT_MS = 25_000;

export interface KeepaOptions {
  apiKey: string;
  includeBuyBox?: boolean;
  fetchImpl?: typeof fetch;
}

export class KeepaProvider implements DataProvider {
  readonly id = "keepa" as const;
  readonly label = "Keepa";
  readonly isSimulated = false;
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
  private lastQuota: QuotaStatus | null = null;

  constructor(private opts: KeepaOptions) {}

  supportsMarketplace(code: MarketplaceCode) {
    return getMarketplace(code).keepaDomainId !== undefined;
  }

  private domain(code: MarketplaceCode): number {
    const id = getMarketplace(code).keepaDomainId;
    if (id === undefined) throw new ProviderError("unsupported", `Keepa doesn't cover ${getMarketplace(code).name}.`, { provider: "keepa" });
    return id;
  }

  private async call(path: string, params: Record<string, string | number>, meta: { operation: string; marketplace: MarketplaceCode | null; items: number; signal?: AbortSignal }) {
    const url = new URL(path, BASE);
    url.searchParams.set("key", this.opts.apiKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const started = Date.now();
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      const signal = meta.signal ? AbortSignal.any([meta.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
      res = await fetchImpl(url, { headers: { "Accept-Encoding": "gzip" }, signal });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      await recordRequest({ provider: "keepa", operation: meta.operation, marketplace: meta.marketplace, itemCount: meta.items, status: timeout ? "timeout" : "error", httpStatus: null, durationMs: Date.now() - started, tokensConsumed: null, tokensLeft: null, error: timeout ? "timeout" : "network error" });
      throw new ProviderError(timeout ? "timeout" : "upstream", timeout ? "Keepa request timed out" : "Could not reach Keepa", { provider: "keepa" });
    }
    let body: KeepaProductResponse & Record<string, unknown> = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Non-JSON error body — handled by status below.
    }
    if (typeof body.tokensLeft === "number") {
      this.lastQuota = {
        provider: "keepa",
        tokensLeft: body.tokensLeft,
        refillRatePerMinute: typeof body.refillRate === "number" ? body.refillRate : null,
        refillInMs: typeof body.refillIn === "number" ? body.refillIn : null,
        checkedAt: new Date(),
      };
    }
    const status = res.status === 200 ? "ok" : res.status === 429 ? "quota_exhausted" : res.status === 401 || res.status === 402 || res.status === 403 ? "auth_error" : "error";
    await recordRequest({
      provider: "keepa",
      operation: meta.operation,
      marketplace: meta.marketplace,
      itemCount: meta.items,
      status,
      httpStatus: res.status,
      durationMs: Date.now() - started,
      tokensConsumed: typeof body.tokensConsumed === "number" ? body.tokensConsumed : null,
      tokensLeft: typeof body.tokensLeft === "number" ? body.tokensLeft : null,
      error: res.ok ? null : (body.error?.message ?? `HTTP ${res.status}`),
    });
    if (res.status === 429) {
      throw new ProviderError("quota_exhausted", "Keepa token bucket is empty", { provider: "keepa", httpStatus: 429, retryAfterMs: typeof body.refillIn === "number" ? body.refillIn : 60_000 });
    }
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new ProviderError("auth", "Keepa rejected the API key or plan", { provider: "keepa", httpStatus: res.status });
    }
    if (res.status === 400 || res.status === 405) {
      throw new ProviderError("invalid_request", body.error?.message ?? "Keepa rejected the request parameters", { provider: "keepa", httpStatus: res.status });
    }
    if (!res.ok) throw new ProviderError("upstream", `Keepa HTTP ${res.status}`, { provider: "keepa", httpStatus: res.status });
    return body;
  }

  async getProducts(marketplace: MarketplaceCode, asins: string[], opts: FetchOptions = {}): Promise<ProductBatch> {
    const domain = this.domain(marketplace);
    const batch = emptyBatch();
    let consumed = 0;
    for (let i = 0; i < asins.length; i += this.capabilities.maxBatchSize) {
      const chunk = asins.slice(i, i + this.capabilities.maxBatchSize);
      const params: Record<string, string | number> = {
        domain,
        asin: chunk.join(","),
        stats: 1,
        history: opts.history ? 1 : 0,
      };
      if (opts.history && opts.historyDays) params.days = opts.historyDays;
      if (this.opts.includeBuyBox !== false) params.buybox = 1;
      if (opts.offers) params.offers = 20;
      const body = await this.call("/product", params, { operation: "product", marketplace, items: chunk.length, signal: opts.signal });
      consumed += typeof body.tokensConsumed === "number" ? body.tokensConsumed : 0;
      const returned = new Set<string>();
      for (const p of body.products ?? []) {
        returned.add(p.asin);
        const mapped = mapProduct(p, marketplace);
        batch.products.push(mapped);
        batch.variations.set(p.asin, variationFamilyFor(p));
        if (opts.history) batch.history.set(p.asin, historyFor(p, marketplace, opts.historyDays ?? 90));
      }
      batch.missing.push(...chunk.filter((a) => !returned.has(a)));
    }
    batch.tokensConsumed = consumed;
    batch.quota = this.lastQuota;
    return batch;
  }

  async getVariations(marketplace: MarketplaceCode, asin: string, opts: FetchOptions = {}): Promise<VariationFamily> {
    const body = await this.call("/product", { domain: this.domain(marketplace), asin, stats: 0, history: 0 }, { operation: "variations", marketplace, items: 1, signal: opts.signal });
    const p = body.products?.[0];
    if (!p) throw new ProviderError("not_found", "Keepa returned no product", { provider: "keepa" });
    return variationFamilyFor(p);
  }

  async searchProducts(marketplace: MarketplaceCode, term: string): Promise<SearchResult[]> {
    const body = await this.call("/search", { domain: this.domain(marketplace), type: "product", term, stats: 0, history: 0 }, { operation: "search", marketplace, items: 0 });
    return (body.products ?? []).slice(0, 20).map((p) => ({ asin: p.asin, title: p.title ?? null, brand: p.brand ?? null, imageUrl: imageUrlFor(p) }));
  }

  async getQuotaStatus(): Promise<QuotaStatus | null> {
    const body = await this.call("/token", {}, { operation: "token", marketplace: null, items: 0 });
    return {
      provider: "keepa",
      tokensLeft: typeof body.tokensLeft === "number" ? body.tokensLeft : null,
      refillRatePerMinute: typeof body.refillRate === "number" ? body.refillRate : null,
      refillInMs: typeof body.refillIn === "number" ? body.refillIn : null,
      checkedAt: new Date(),
    };
  }

  async diagnose() {
    try {
      const q = await this.getQuotaStatus();
      return { ok: true, message: `Connected. ${q?.tokensLeft ?? "?"} tokens available, refilling ${q?.refillRatePerMinute ?? "?"}/min.` };
    } catch (e) {
      return { ok: false, message: e instanceof ProviderError ? e.userMessage : "Could not reach Keepa." };
    }
  }
}
