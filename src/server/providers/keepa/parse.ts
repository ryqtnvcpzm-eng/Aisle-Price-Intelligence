/**
 * Pure mapping from Keepa's `product` objects to Aisle's provider types.
 *
 * Keepa conventions (from Keepa's API backend `Product.java`, mirrored by the
 * official Python client):
 *  - Times are "Keepa minutes" since 2011-01-01T00:00Z.
 *  - Prices are integers in the marketplace's minor unit; -1 = no offer, -2 = no data.
 *  - `csv[i]` is a flat history array: [t, v, t, v, …], except the *_SHIPPING
 *    types which are triples [t, price, shipping, …].
 *  - `stats.current[i]` holds the current value for csv type i (when stats requested).
 */
import { getMarketplace, type MarketplaceCode } from "@/lib/marketplaces";
import type { Availability, PriceSnapshot, ProviderProduct, VariationFamily } from "../types";

export const KEEPA_EPOCH_MINUTES = 21_564_000; // minutes from Unix epoch to 2011-01-01
export const CSV = {
  AMAZON: 0,
  NEW: 1,
  LISTPRICE: 4,
  LIGHTNING_DEAL: 8,
  NEW_FBA: 10,
  COUNT_NEW: 11,
  BUY_BOX_SHIPPING: 18,
  PRIME_EXCL: 33,
} as const;
const TRIPLE_TYPES = new Set([7, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32]);

export function keepaMinutesToDate(m: number): Date {
  return new Date((m + KEEPA_EPOCH_MINUTES) * 60_000);
}
export function dateToKeepaMinutes(d: Date): number {
  return Math.floor(d.getTime() / 60_000) - KEEPA_EPOCH_MINUTES;
}

export interface KeepaProduct {
  asin: string;
  domainId?: number;
  productType?: number; // 0 standard, 1 downloadable, 2 ebook, 3 unaccessible, 4 invalid, 5 variation parent
  title?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  parentAsin?: string | null;
  variationCSV?: string | null;
  variations?: { asin: string; attributes?: { dimension: string; value: string }[] }[] | null;
  imagesCSV?: string | null;
  images?: { l?: string; m?: string }[] | null;
  categoryTree?: { catId: number; name: string }[] | null;
  size?: string | null;
  color?: string | null;
  packageQuantity?: number | null;
  numberOfItems?: number | null;
  lastUpdate?: number;
  lastPriceChange?: number;
  availabilityAmazon?: number;
  csv?: (number[] | null)[] | null;
  stats?: {
    current?: number[];
    buyBoxPrice?: number;
    buyBoxShipping?: number;
    buyBoxIsAmazon?: boolean | null;
    buyBoxSellerId?: string | null;
    buyBoxIsFBA?: boolean | null;
  } | null;
  offers?: unknown[] | null;
}

export interface KeepaProductResponse {
  timestamp?: number;
  tokensLeft?: number;
  refillIn?: number;
  refillRate?: number;
  tokensConsumed?: number;
  processingTimeInMs?: number;
  products?: KeepaProduct[];
  error?: { type?: string; message?: string; details?: string };
}

const price = (v: number | undefined | null): number | null => (v === undefined || v === null || v < 0 ? null : v);

/** Last value of a csv series (handles pair and triple layouts). */
function lastOf(product: KeepaProduct, type: number): { t: number; v: number; ship?: number } | null {
  const arr = product.csv?.[type];
  if (!arr || arr.length < 2) return null;
  const step = TRIPLE_TYPES.has(type) ? 3 : 2;
  const i = arr.length - step;
  return { t: arr[i]!, v: arr[i + 1]!, ship: step === 3 ? arr[i + 2] : undefined };
}

function current(product: KeepaProduct, type: number): number | null {
  const s = product.stats?.current?.[type];
  if (s !== undefined) return price(s);
  const last = lastOf(product, type);
  return last ? price(last.v) : null;
}

export function imageUrlFor(product: KeepaProduct): string | null {
  const name = product.images?.[0]?.l ?? product.images?.[0]?.m ?? product.imagesCSV?.split(",")[0];
  return name ? `https://m.media-amazon.com/images/I/${name}` : null;
}

export function variationAttributesFor(product: KeepaProduct): Record<string, string> | null {
  const own = product.variations?.find((v) => v.asin === product.asin);
  if (!own?.attributes?.length) return null;
  return Object.fromEntries(own.attributes.map((a) => [a.dimension, a.value]));
}

function availabilityFor(product: KeepaProduct, featured: number | null): Availability {
  if (featured !== null) return "in_stock";
  // Amazon-as-seller availability codes: 0 in stock, 1 pre-order, 3 back-order, 4 delayed; -1 no Amazon offer.
  if (product.availabilityAmazon === 1) return "preorder";
  if (product.availabilityAmazon === 3 || product.availabilityAmazon === 4) return "limited";
  const newCount = current(product, CSV.COUNT_NEW);
  if (newCount === 0) return "out_of_stock";
  if (product.stats?.current) return "out_of_stock";
  return "unknown";
}

export function snapshotFor(product: KeepaProduct, marketplace: MarketplaceCode): PriceSnapshot | null {
  if (!product.stats?.current && !product.csv) return null;
  const currency = getMarketplace(marketplace).currency;

  let buyBox = price(product.stats?.buyBoxPrice);
  let shipping = price(product.stats?.buyBoxShipping);
  if (buyBox === null) {
    const bb = lastOf(product, CSV.BUY_BOX_SHIPPING);
    if (bb && bb.v >= 0) {
      // BUY_BOX_SHIPPING triples are [t, itemPrice, shipping]; landed = itemPrice + shipping.
      shipping = bb.ship !== undefined && bb.ship >= 0 ? bb.ship : null;
      buyBox = bb.v;
    }
  }
  const amazon = current(product, CSV.AMAZON);
  const lowestNew = current(product, CSV.NEW);
  const featured = buyBox ?? amazon ?? lowestNew;
  const basis = buyBox !== null ? "buy_box" : amazon !== null ? "amazon" : lowestNew !== null ? "lowest_new" : "none";

  const sellerId = product.stats?.buyBoxSellerId ?? null;
  return {
    observedAt: product.lastUpdate ? keepaMinutesToDate(product.lastUpdate) : new Date(),
    currency,
    priceMinor: featured,
    priceBasis: basis,
    amazonPriceMinor: amazon,
    lowestNewPriceMinor: lowestNew,
    listPriceMinor: current(product, CSV.LISTPRICE),
    dealPriceMinor: current(product, CSV.LIGHTNING_DEAL),
    primeExclusivePriceMinor: current(product, CSV.PRIME_EXCL),
    shippingMinor: basis === "buy_box" ? shipping : null,
    availability: availabilityFor(product, featured),
    seller: sellerId ? { id: sellerId, name: null, isAmazon: product.stats?.buyBoxIsAmazon ?? null } : null,
  };
}

export function statusFor(product: KeepaProduct): ProviderProduct["status"] {
  if (product.productType === 4) return "invalid";
  if (product.productType === 3) return "unavailable";
  if (!product.title && !product.csv) return "not_found";
  return "active";
}

export function mapProduct(product: KeepaProduct, marketplace: MarketplaceCode): ProviderProduct {
  return {
    marketplace,
    asin: product.asin,
    parentAsin: product.parentAsin ?? (product.productType === 5 ? product.asin : null),
    title: product.title ?? null,
    brand: product.brand ?? product.manufacturer ?? null,
    imageUrl: imageUrlFor(product),
    categoryPath: product.categoryTree?.map((c) => c.name) ?? null,
    variationAttributes: variationAttributesFor(product),
    sizeText: product.size ?? null,
    packageQuantity: product.packageQuantity && product.packageQuantity > 0 ? product.packageQuantity : null,
    status: statusFor(product),
    providerUpdatedAt: product.lastUpdate ? keepaMinutesToDate(product.lastUpdate) : null,
    snapshot: product.productType === 5 ? null : snapshotFor(product, marketplace),
    isSimulated: false,
  };
}

export function variationFamilyFor(product: KeepaProduct): VariationFamily {
  const listed = product.variations ?? [];
  const csvAsins = (product.variationCSV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!listed.length && !csvAsins.length) {
    return {
      parentAsin: product.parentAsin ?? null,
      dimensions: [],
      children: [{ asin: product.asin, attributes: {} }],
      completeness: product.parentAsin ? "unavailable" : "single",
      note: product.parentAsin
        ? "This listing belongs to a variation family, but Keepa didn't return its siblings."
        : "This listing has no variations on Amazon, according to Keepa.",
      reportedTotal: null,
    };
  }
  const dims = new Set<string>();
  const children = listed.map((v) => {
    const attributes = Object.fromEntries((v.attributes ?? []).map((a) => [a.dimension, a.value]));
    Object.keys(attributes).forEach((d) => dims.add(d));
    return { asin: v.asin, attributes };
  });
  for (const asin of csvAsins) if (!children.some((c) => c.asin === asin)) children.push({ asin, attributes: {} });
  const reportedTotal = csvAsins.length || listed.length;
  const complete = listed.length > 0 && (csvAsins.length === 0 || csvAsins.every((a) => listed.some((l) => l.asin === a)));
  return {
    parentAsin: product.parentAsin ?? (product.productType === 5 ? product.asin : null),
    dimensions: [...dims],
    children,
    completeness: complete ? "complete" : "partial",
    note: complete
      ? `Keepa reports ${reportedTotal} variation${reportedTotal === 1 ? "" : "s"} with attributes for each.`
      : `Keepa lists ${reportedTotal} variations but returned attributes for only ${listed.length}. Some may be missing labels.`,
    reportedTotal,
  };
}

/**
 * Build a change-point history from the featured price series (Buy Box when
 * present, else Amazon, else lowest New). Each point is a *recorded change*,
 * not a continuous confirmation — consumers render it as a step series.
 */
export function historyFor(product: KeepaProduct, marketplace: MarketplaceCode, sinceDays: number): PriceSnapshot[] {
  const currency = getMarketplace(marketplace).currency;
  const since = Date.now() - sinceDays * 86_400_000;
  const pick = (type: number) => (product.csv?.[type]?.length ? type : null);
  const type = pick(CSV.BUY_BOX_SHIPPING) ?? pick(CSV.AMAZON) ?? pick(CSV.NEW);
  if (type === null) return [];
  const arr = product.csv![type]!;
  const step = TRIPLE_TYPES.has(type) ? 3 : 2;
  const basis = type === CSV.BUY_BOX_SHIPPING ? "buy_box" : type === CSV.AMAZON ? "amazon" : "lowest_new";
  const out: PriceSnapshot[] = [];
  for (let i = 0; i + step - 1 < arr.length; i += step) {
    const at = keepaMinutesToDate(arr[i]!);
    if (at.getTime() < since) continue;
    const raw = arr[i + 1]!;
    const ship = step === 3 ? arr[i + 2]! : -1;
    const p = price(raw);
    const shippingMinor = ship >= 0 ? ship : null;
    out.push({
      observedAt: at,
      currency,
      priceMinor: p,
      priceBasis: p === null ? "none" : basis,
      amazonPriceMinor: null,
      lowestNewPriceMinor: null,
      listPriceMinor: null,
      dealPriceMinor: null,
      primeExclusivePriceMinor: null,
      shippingMinor,
      availability: p === null ? "out_of_stock" : "in_stock",
      seller: null,
    });
  }
  return out;
}
