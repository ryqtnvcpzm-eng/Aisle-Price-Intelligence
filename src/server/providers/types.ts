/**
 * Provider abstraction. Each adapter implements only what its upstream API
 * genuinely supports and declares it in `capabilities`; callers check
 * capabilities instead of assuming. Fields an upstream doesn't return are
 * `null` — never guessed.
 */
import type { MarketplaceCode } from "@/lib/marketplaces";

export type ProviderId = "keepa" | "creators" | "demo";
export type Availability = "in_stock" | "out_of_stock" | "limited" | "preorder" | "unknown";
export type PriceBasis = "buy_box" | "amazon" | "lowest_new" | "none";
export type ListingStatus = "active" | "unavailable" | "discontinued" | "not_found" | "invalid";

export interface SellerRef {
  id: string;
  name: string | null;
  isAmazon: boolean | null;
}

/** A point-in-time price reading. All amounts in integer minor units. */
export interface PriceSnapshot {
  observedAt: Date;
  currency: string;
  priceMinor: number | null;
  priceBasis: PriceBasis;
  amazonPriceMinor: number | null;
  lowestNewPriceMinor: number | null;
  listPriceMinor: number | null;
  dealPriceMinor: number | null;
  primeExclusivePriceMinor: number | null;
  shippingMinor: number | null;
  availability: Availability;
  seller: SellerRef | null;
}

export interface ProviderProduct {
  marketplace: MarketplaceCode;
  asin: string;
  parentAsin: string | null;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
  categoryPath: string[] | null;
  /** This item's own variation values, e.g. { Size: "1 kg", Flavor: "Chocolate" }. */
  variationAttributes: Record<string, string> | null;
  sizeText: string | null;
  packageQuantity: number | null;
  status: ListingStatus;
  /** When the provider last refreshed its own copy of this product. */
  providerUpdatedAt: Date | null;
  snapshot: PriceSnapshot | null;
  isSimulated: boolean;
}

export interface VariationChild {
  asin: string;
  attributes: Record<string, string>;
}

export interface VariationFamily {
  parentAsin: string | null;
  dimensions: string[];
  children: VariationChild[];
  /** How sure we are this is the whole family, as reported by the provider. */
  completeness: "complete" | "partial" | "unavailable" | "single";
  /** Human-readable explanation, shown verbatim in the UI. */
  note: string;
  /** Total the provider claims exists, when it reports one. */
  reportedTotal: number | null;
}

export interface QuotaStatus {
  provider: ProviderId;
  tokensLeft: number | null;
  refillRatePerMinute: number | null;
  refillInMs: number | null;
  checkedAt: Date;
  note?: string;
}

export interface Offer {
  seller: SellerRef | null;
  condition: string;
  priceMinor: number | null;
  shippingMinor: number | null;
  currency: string;
  isBuyBox: boolean | null;
  isPrime: boolean | null;
  isFba: boolean | null;
}

export interface FetchOptions {
  /** Include historical series (for backfill on import). */
  history?: boolean;
  historyDays?: number;
  offers?: boolean;
  signal?: AbortSignal;
}

export interface ProductBatch {
  products: ProviderProduct[];
  /** ASINs the provider returned nothing for. */
  missing: string[];
  history: Map<string, PriceSnapshot[]>;
  offers: Map<string, Offer[]>;
  variations: Map<string, VariationFamily>;
  tokensConsumed: number | null;
  quota: QuotaStatus | null;
  requestedAt: Date;
}

export interface ProviderCapabilities {
  productDetails: boolean;
  variations: boolean;
  currentOffers: boolean;
  priceHistory: boolean;
  search: boolean;
  availability: boolean;
  providerFreshness: boolean;
  quota: boolean;
  /** Persisting observations over time is allowed by the provider's terms as configured. */
  monitoring: boolean;
  maxBatchSize: number;
}

export interface SearchResult {
  asin: string;
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
}

export interface DataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly isSimulated: boolean;
  readonly capabilities: ProviderCapabilities;
  supportsMarketplace(code: MarketplaceCode): boolean;
  getProducts(marketplace: MarketplaceCode, asins: string[], opts?: FetchOptions): Promise<ProductBatch>;
  getVariations(marketplace: MarketplaceCode, asin: string, opts?: FetchOptions): Promise<VariationFamily>;
  searchProducts?(marketplace: MarketplaceCode, term: string): Promise<SearchResult[]>;
  getQuotaStatus(): Promise<QuotaStatus | null>;
  /** Diagnostics for Settings → Data providers. Must not leak credentials. */
  diagnose(): Promise<{ ok: boolean; message: string }>;
}

export type ProviderErrorKind =
  | "auth"
  | "rate_limited"
  | "quota_exhausted"
  | "unsupported"
  | "timeout"
  | "upstream"
  | "not_found"
  | "invalid_request";

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public opts: { retryAfterMs?: number; httpStatus?: number; provider?: ProviderId } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable() {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "upstream" || this.kind === "quota_exhausted";
  }

  /** Copy safe to show in the UI. */
  get userMessage(): string {
    switch (this.kind) {
      case "auth":
        return "The data provider rejected our credentials. Check Settings → Data providers.";
      case "rate_limited":
        return "The data provider is rate-limiting requests. Aisle will retry automatically.";
      case "quota_exhausted":
        return "The provider's request allowance is used up for now. Refreshes resume when it refills.";
      case "unsupported":
        return this.message;
      case "timeout":
        return "The data provider took too long to respond.";
      case "not_found":
        return "The provider has no record of this listing.";
      case "invalid_request":
        return this.message;
      default:
        return "The data provider returned an error. We'll try again shortly.";
    }
  }
}

export function emptyBatch(): ProductBatch {
  return {
    products: [],
    missing: [],
    history: new Map(),
    offers: new Map(),
    variations: new Map(),
    tokensConsumed: null,
    quota: null,
    requestedAt: new Date(),
  };
}
