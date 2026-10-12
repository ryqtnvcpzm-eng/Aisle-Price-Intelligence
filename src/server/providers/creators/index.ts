/**
 * Amazon Creators API adapter (successor to the deprecated PA-API 5).
 *
 * Endpoints/auth mirror Amazon's official SDK: POST https://creatorsapi.amazon/catalog/v1/{getItems,getVariations,searchItems}
 * with an `x-marketplace` header and an OAuth2 client-credentials bearer token
 * from the version-specific token endpoint.
 *
 * LICENSING: the Creators API is part of the Amazon Associates program. Its
 * terms are written for driving referral traffic, not standalone competitive
 * analytics, and restrict caching/storing data. So by default this adapter is
 * *lookup only* (import previews, variation discovery); `capabilities.monitoring`
 * is false and Aisle won't persist its prices on a schedule unless the operator
 * sets CREATORS_API_LICENSE_ACK=true after reviewing their own agreement.
 * It provides no price history — that's not something the API offers.
 */
import { getMarketplace, type MarketplaceCode } from "@/lib/marketplaces";
import { majorToMinor } from "@/lib/money";
import { recordRequest } from "../accounting";
import {
  emptyBatch,
  ProviderError,
  type Availability,
  type DataProvider,
  type FetchOptions,
  type ProductBatch,
  type ProviderProduct,
  type QuotaStatus,
  type SearchResult,
  type VariationFamily,
} from "../types";

const BASE = "https://creatorsapi.amazon";
const TOKEN_ENDPOINTS: Record<string, string> = {
  "2.1": "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token",
  "2.2": "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token",
  "2.3": "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token",
  "3.1": "https://api.amazon.com/auth/o2/token",
  "3.2": "https://api.amazon.co.uk/auth/o2/token",
  "3.3": "https://api.amazon.co.jp/auth/o2/token",
};
const ITEM_RESOURCES = [
  "images.primary.large",
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "itemInfo.classifications",
  "itemInfo.productInfo",
  "parentASIN",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.condition",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.dealDetails",
  "offersV2.listings.type",
];

interface Money {
  amount?: number;
  currency?: string;
}
interface CreatorsItem {
  asin: string;
  parentASIN?: string;
  detailPageURL?: string;
  images?: { primary?: { large?: { url?: string }; medium?: { url?: string } } };
  itemInfo?: {
    title?: { displayValue?: string };
    byLineInfo?: { brand?: { displayValue?: string }; manufacturer?: { displayValue?: string } };
    classifications?: { productGroup?: { displayValue?: string }; binding?: { displayValue?: string } };
    productInfo?: { size?: { displayValue?: string }; unitCount?: { displayValue?: number } };
  };
  variationAttributes?: { name: string; value: string }[];
  offersV2?: {
    listings?: {
      isBuyBoxWinner?: boolean;
      type?: string;
      price?: { money?: Money; savingBasis?: { money?: Money; savingBasisType?: string } };
      availability?: { type?: string };
      condition?: { value?: string };
      merchantInfo?: { id?: string; name?: string };
      dealDetails?: { badge?: string };
    }[];
  };
}

export interface CreatorsOptions {
  credentialId: string;
  credentialSecret: string;
  version: string;
  partnerTag: string;
  licenseAck: boolean;
  fetchImpl?: typeof fetch;
}

function mapAvailability(type: string | undefined): Availability {
  switch ((type ?? "").toUpperCase()) {
    case "IN_STOCK":
    case "AVAILABLE":
      return "in_stock";
    case "OUT_OF_STOCK":
    case "UNAVAILABLE":
      return "out_of_stock";
    case "PREORDER":
    case "AVAILABLE_DATE":
      return "preorder";
    case "LEADTIME":
    case "IN_STOCK_SCARCE":
    case "LIMITED":
      return "limited";
    default:
      return "unknown";
  }
}

const AMAZON_MERCHANT = /^Amazon(\.[a-z.]+)?$/i;

export function mapCreatorsItem(item: CreatorsItem, marketplace: MarketplaceCode, observedAt: Date): ProviderProduct {
  const mp = getMarketplace(marketplace);
  const listings = item.offersV2?.listings ?? [];
  const featured = listings.find((l) => l.isBuyBoxWinner) ?? listings[0];
  const money = featured?.price?.money;
  const currency = money?.currency ?? mp.currency;
  const priceMinor = typeof money?.amount === "number" ? majorToMinor(money.amount, currency) : null;
  const basisMoney = featured?.price?.savingBasis;
  const listPriceMinor =
    basisMoney?.savingBasisType === "LIST_PRICE" && typeof basisMoney.money?.amount === "number" ? majorToMinor(basisMoney.money.amount, currency) : null;
  const merchant = featured?.merchantInfo;
  const attrs = item.variationAttributes?.length ? Object.fromEntries(item.variationAttributes.map((a) => [a.name, a.value])) : null;
  return {
    marketplace,
    asin: item.asin,
    parentAsin: item.parentASIN ?? null,
    title: item.itemInfo?.title?.displayValue ?? null,
    brand: item.itemInfo?.byLineInfo?.brand?.displayValue ?? item.itemInfo?.byLineInfo?.manufacturer?.displayValue ?? null,
    imageUrl: item.images?.primary?.large?.url ?? item.images?.primary?.medium?.url ?? null,
    categoryPath: item.itemInfo?.classifications?.productGroup?.displayValue ? [item.itemInfo.classifications.productGroup.displayValue] : null,
    variationAttributes: attrs,
    sizeText: item.itemInfo?.productInfo?.size?.displayValue ?? null,
    packageQuantity: null,
    status: "active",
    providerUpdatedAt: null, // The API doesn't expose when Amazon last changed the data.
    isSimulated: false,
    snapshot: featured
      ? {
          observedAt,
          currency,
          priceMinor,
          priceBasis: priceMinor === null ? "none" : featured.isBuyBoxWinner ? "buy_box" : "lowest_new",
          amazonPriceMinor: merchant?.name && AMAZON_MERCHANT.test(merchant.name) ? priceMinor : null,
          lowestNewPriceMinor: null,
          listPriceMinor,
          dealPriceMinor: featured.type === "LIGHTNING_DEAL" ? priceMinor : null,
          primeExclusivePriceMinor: null,
          shippingMinor: null,
          availability: mapAvailability(featured.availability?.type),
          seller: merchant?.id ? { id: merchant.id, name: merchant.name ?? null, isAmazon: merchant.name ? AMAZON_MERCHANT.test(merchant.name) : null } : null,
        }
      : null,
  };
}

export class CreatorsProvider implements DataProvider {
  readonly id = "creators" as const;
  readonly label = "Amazon Creators API";
  readonly isSimulated = false;
  readonly capabilities;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private opts: CreatorsOptions) {
    this.capabilities = {
      productDetails: true,
      variations: true,
      currentOffers: true,
      priceHistory: false,
      search: true,
      availability: true,
      providerFreshness: false,
      quota: false,
      monitoring: opts.licenseAck,
      maxBatchSize: 10,
    };
  }

  supportsMarketplace(code: MarketplaceCode) {
    return Boolean(getMarketplace(code).creatorsMarketplace);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const endpoint = TOKEN_ENDPOINTS[this.opts.version];
    if (!endpoint) throw new ProviderError("auth", `Unsupported Creators API credential version ${this.opts.version}`, { provider: "creators" });
    const isLwa = this.opts.version.startsWith("3.");
    const fields = { grant_type: "client_credentials", client_id: this.opts.credentialId, client_secret: this.opts.credentialSecret, scope: isLwa ? "creatorsapi::default" : "creatorsapi/default" };
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": isLwa ? "application/json" : "application/x-www-form-urlencoded" },
      body: isLwa ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new ProviderError("upstream", "Could not reach the Creators API token endpoint", { provider: "creators" });
    });
    if (!res.ok) throw new ProviderError("auth", "Creators API rejected the credentials", { provider: "creators", httpStatus: res.status });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new ProviderError("auth", "Creators API returned no access token", { provider: "creators" });
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call<T>(op: string, marketplace: MarketplaceCode, body: Record<string, unknown>, items: number): Promise<T> {
    const token = await this.getToken();
    const auth = this.opts.version.startsWith("3.") ? `Bearer ${token}` : `Bearer ${token}, Version ${this.opts.version}`;
    const started = Date.now();
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}/catalog/v1/${op}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: auth, "x-marketplace": getMarketplace(marketplace).creatorsMarketplace! },
        body: JSON.stringify({ partnerTag: this.opts.partnerTag, ...body }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      await recordRequest({ provider: "creators", operation: op, marketplace, itemCount: items, status: "timeout", httpStatus: null, durationMs: Date.now() - started, tokensConsumed: null, tokensLeft: null, error: "timeout" });
      throw new ProviderError("timeout", "Creators API timed out", { provider: "creators" });
    }
    const status = res.ok ? "ok" : res.status === 429 ? "rate_limited" : res.status === 401 || res.status === 403 ? "auth_error" : "error";
    await recordRequest({ provider: "creators", operation: op, marketplace, itemCount: items, status, httpStatus: res.status, durationMs: Date.now() - started, tokensConsumed: null, tokensLeft: null, error: res.ok ? null : `HTTP ${res.status}` });
    if (res.status === 429) throw new ProviderError("rate_limited", "Creators API throttled the request", { provider: "creators", retryAfterMs: 5_000 });
    if (res.status === 401 || res.status === 403) throw new ProviderError("auth", "Creators API denied access", { provider: "creators", httpStatus: res.status });
    if (!res.ok) throw new ProviderError("upstream", `Creators API HTTP ${res.status}`, { provider: "creators", httpStatus: res.status });
    return (await res.json()) as T;
  }

  async getProducts(marketplace: MarketplaceCode, asins: string[], _opts: FetchOptions = {}): Promise<ProductBatch> {
    if (!this.supportsMarketplace(marketplace)) throw new ProviderError("unsupported", `Creators API isn't configured for ${marketplace}.`);
    const batch = emptyBatch();
    for (let i = 0; i < asins.length; i += this.capabilities.maxBatchSize) {
      const chunk = asins.slice(i, i + this.capabilities.maxBatchSize);
      const json = await this.call<{ itemsResult?: { items?: CreatorsItem[] } }>("getItems", marketplace, { itemIds: chunk, resources: ITEM_RESOURCES }, chunk.length);
      const items = json.itemsResult?.items ?? [];
      const seen = new Set(items.map((x) => x.asin));
      for (const item of items) batch.products.push(mapCreatorsItem(item, marketplace, batch.requestedAt));
      batch.missing.push(...chunk.filter((a) => !seen.has(a)));
    }
    return batch;
  }

  async getVariations(marketplace: MarketplaceCode, asin: string): Promise<VariationFamily> {
    type Resp = { variationsResult?: { items?: CreatorsItem[]; variationSummary?: { variationCount?: number; pageCount?: number; variationDimensions?: { name: string; displayName?: string }[] } } };
    const children: { asin: string; attributes: Record<string, string> }[] = [];
    let summary: NonNullable<Resp["variationsResult"]>["variationSummary"];
    let parent: string | null = null;
    const MAX_PAGES = 5;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const json = await this.call<Resp>("getVariations", marketplace, { asin, variationPage: page, resources: ["variationSummary.variationDimension", "parentASIN"] }, 1);
      summary ??= json.variationsResult?.variationSummary;
      for (const item of json.variationsResult?.items ?? []) {
        parent ??= item.parentASIN ?? null;
        children.push({ asin: item.asin, attributes: Object.fromEntries((item.variationAttributes ?? []).map((a) => [a.name, a.value])) });
      }
      if (!summary?.pageCount || page >= summary.pageCount) break;
    }
    const total = summary?.variationCount ?? null;
    if (!children.length) {
      return { parentAsin: null, dimensions: [], children: [{ asin, attributes: {} }], completeness: "single", note: "No variations were returned by the Creators API.", reportedTotal: total };
    }
    const complete = total !== null && children.length >= total;
    return {
      parentAsin: parent,
      dimensions: summary?.variationDimensions?.map((d) => d.displayName ?? d.name) ?? [],
      children,
      completeness: complete ? "complete" : "partial",
      note: complete ? `Creators API reports ${total} variations; all retrieved.` : `Retrieved ${children.length} of ${total ?? "an unknown number of"} variations (page limit).`,
      reportedTotal: total,
    };
  }

  async searchProducts(marketplace: MarketplaceCode, term: string): Promise<SearchResult[]> {
    const json = await this.call<{ searchResult?: { items?: CreatorsItem[] } }>("searchItems", marketplace, { keywords: term, resources: ["itemInfo.title", "itemInfo.byLineInfo", "images.primary.medium"] }, 0);
    return (json.searchResult?.items ?? []).map((i) => ({ asin: i.asin, title: i.itemInfo?.title?.displayValue ?? null, brand: i.itemInfo?.byLineInfo?.brand?.displayValue ?? null, imageUrl: i.images?.primary?.medium?.url ?? null }));
  }

  async getQuotaStatus(): Promise<QuotaStatus | null> {
    return null; // The API doesn't expose a quota endpoint; throttling surfaces as HTTP 429.
  }

  async diagnose() {
    try {
      await this.getToken();
      return { ok: true, message: this.opts.licenseAck ? "Authenticated. Monitoring enabled by operator license acknowledgement." : "Authenticated. Lookup-only: scheduled price storage is disabled until you confirm your Associates agreement allows it." };
    } catch (e) {
      return { ok: false, message: e instanceof ProviderError ? e.userMessage : "Could not authenticate." };
    }
  }
}
