/**
 * Amazon marketplace registry.
 *
 * Client-safe: contains no secrets. Extending Aisle to a new Amazon domain
 * means adding one entry here (and, if a provider covers it, its provider id).
 * Entries without a `creatorsMarketplace` are reported as unsupported by the
 * Creators API adapter instead of guessed.
 */

export const MARKETPLACE_CODES = [
  "IN",
  "US",
  "CA",
  "GB",
  "DE",
  "FR",
  "IT",
  "ES",
  "JP",
  "AU",
  "AE",
  "MX",
  "BR",
  "NL",
  "SE",
  "PL",
  "SG",
  "SA",
  "TR",
] as const;

export type MarketplaceCode = (typeof MARKETPLACE_CODES)[number];

export interface Marketplace {
  code: MarketplaceCode;
  name: string;
  /** Primary storefront host, used to build canonical listing URLs. */
  domain: string;
  /** Additional hosts that serve the same storefront (mobile, smile, www-less). */
  aliases: string[];
  currency: string;
  /** Number of minor units in the currency (JPY = 0). */
  currencyExponent: number;
  locale: string;
  timeZone: string;
  flag: string;
  /** Creators API x-marketplace header value. */
  creatorsMarketplace?: string;
}

const m = (x: Marketplace) => x;

export const MARKETPLACES: Record<MarketplaceCode, Marketplace> = {
  IN: m({ code: "IN", name: "Amazon India", domain: "www.amazon.in", aliases: ["amazon.in", "m.amazon.in"], currency: "INR", currencyExponent: 2, locale: "en-IN", timeZone: "Asia/Kolkata", flag: "🇮🇳", creatorsMarketplace: "www.amazon.in" }),
  US: m({ code: "US", name: "Amazon US", domain: "www.amazon.com", aliases: ["amazon.com", "m.amazon.com", "smile.amazon.com"], currency: "USD", currencyExponent: 2, locale: "en-US", timeZone: "America/New_York", flag: "🇺🇸", creatorsMarketplace: "www.amazon.com" }),
  CA: m({ code: "CA", name: "Amazon Canada", domain: "www.amazon.ca", aliases: ["amazon.ca", "m.amazon.ca"], currency: "CAD", currencyExponent: 2, locale: "en-CA", timeZone: "America/Toronto", flag: "🇨🇦", creatorsMarketplace: "www.amazon.ca" }),
  GB: m({ code: "GB", name: "Amazon UK", domain: "www.amazon.co.uk", aliases: ["amazon.co.uk", "m.amazon.co.uk"], currency: "GBP", currencyExponent: 2, locale: "en-GB", timeZone: "Europe/London", flag: "🇬🇧", creatorsMarketplace: "www.amazon.co.uk" }),
  DE: m({ code: "DE", name: "Amazon Germany", domain: "www.amazon.de", aliases: ["amazon.de", "m.amazon.de"], currency: "EUR", currencyExponent: 2, locale: "de-DE", timeZone: "Europe/Berlin", flag: "🇩🇪", creatorsMarketplace: "www.amazon.de" }),
  FR: m({ code: "FR", name: "Amazon France", domain: "www.amazon.fr", aliases: ["amazon.fr", "m.amazon.fr"], currency: "EUR", currencyExponent: 2, locale: "fr-FR", timeZone: "Europe/Paris", flag: "🇫🇷", creatorsMarketplace: "www.amazon.fr" }),
  IT: m({ code: "IT", name: "Amazon Italy", domain: "www.amazon.it", aliases: ["amazon.it", "m.amazon.it"], currency: "EUR", currencyExponent: 2, locale: "it-IT", timeZone: "Europe/Rome", flag: "🇮🇹", creatorsMarketplace: "www.amazon.it" }),
  ES: m({ code: "ES", name: "Amazon Spain", domain: "www.amazon.es", aliases: ["amazon.es", "m.amazon.es"], currency: "EUR", currencyExponent: 2, locale: "es-ES", timeZone: "Europe/Madrid", flag: "🇪🇸", creatorsMarketplace: "www.amazon.es" }),
  JP: m({ code: "JP", name: "Amazon Japan", domain: "www.amazon.co.jp", aliases: ["amazon.co.jp", "m.amazon.co.jp"], currency: "JPY", currencyExponent: 0, locale: "ja-JP", timeZone: "Asia/Tokyo", flag: "🇯🇵", creatorsMarketplace: "www.amazon.co.jp" }),
  AU: m({ code: "AU", name: "Amazon Australia", domain: "www.amazon.com.au", aliases: ["amazon.com.au", "m.amazon.com.au"], currency: "AUD", currencyExponent: 2, locale: "en-AU", timeZone: "Australia/Sydney", flag: "🇦🇺", creatorsMarketplace: "www.amazon.com.au" }),
  AE: m({ code: "AE", name: "Amazon UAE", domain: "www.amazon.ae", aliases: ["amazon.ae", "m.amazon.ae"], currency: "AED", currencyExponent: 2, locale: "en-AE", timeZone: "Asia/Dubai", flag: "🇦🇪", creatorsMarketplace: "www.amazon.ae" }),
  MX: m({ code: "MX", name: "Amazon Mexico", domain: "www.amazon.com.mx", aliases: ["amazon.com.mx", "m.amazon.com.mx"], currency: "MXN", currencyExponent: 2, locale: "es-MX", timeZone: "America/Mexico_City", flag: "🇲🇽", creatorsMarketplace: "www.amazon.com.mx" }),
  BR: m({ code: "BR", name: "Amazon Brazil", domain: "www.amazon.com.br", aliases: ["amazon.com.br", "m.amazon.com.br"], currency: "BRL", currencyExponent: 2, locale: "pt-BR", timeZone: "America/Sao_Paulo", flag: "🇧🇷", creatorsMarketplace: "www.amazon.com.br" }),
  NL: m({ code: "NL", name: "Amazon Netherlands", domain: "www.amazon.nl", aliases: ["amazon.nl"], currency: "EUR", currencyExponent: 2, locale: "nl-NL", timeZone: "Europe/Amsterdam", flag: "🇳🇱", creatorsMarketplace: "www.amazon.nl" }),
  SE: m({ code: "SE", name: "Amazon Sweden", domain: "www.amazon.se", aliases: ["amazon.se"], currency: "SEK", currencyExponent: 2, locale: "sv-SE", timeZone: "Europe/Stockholm", flag: "🇸🇪", creatorsMarketplace: "www.amazon.se" }),
  PL: m({ code: "PL", name: "Amazon Poland", domain: "www.amazon.pl", aliases: ["amazon.pl"], currency: "PLN", currencyExponent: 2, locale: "pl-PL", timeZone: "Europe/Warsaw", flag: "🇵🇱", creatorsMarketplace: "www.amazon.pl" }),
  SG: m({ code: "SG", name: "Amazon Singapore", domain: "www.amazon.sg", aliases: ["amazon.sg"], currency: "SGD", currencyExponent: 2, locale: "en-SG", timeZone: "Asia/Singapore", flag: "🇸🇬", creatorsMarketplace: "www.amazon.sg" }),
  SA: m({ code: "SA", name: "Amazon Saudi Arabia", domain: "www.amazon.sa", aliases: ["amazon.sa"], currency: "SAR", currencyExponent: 2, locale: "en-SA", timeZone: "Asia/Riyadh", flag: "🇸🇦", creatorsMarketplace: "www.amazon.sa" }),
  TR: m({ code: "TR", name: "Amazon Türkiye", domain: "www.amazon.com.tr", aliases: ["amazon.com.tr"], currency: "TRY", currencyExponent: 2, locale: "tr-TR", timeZone: "Europe/Istanbul", flag: "🇹🇷", creatorsMarketplace: "www.amazon.com.tr" }),
};

/** Marketplaces surfaced first in pickers — the set the product brief requires. */
export const PRIMARY_MARKETPLACES: MarketplaceCode[] = ["IN", "US", "CA", "GB", "DE", "FR", "IT", "ES", "JP", "AU", "AE"];

const hostIndex = new Map<string, MarketplaceCode>();
for (const mp of Object.values(MARKETPLACES)) {
  hostIndex.set(mp.domain, mp.code);
  for (const a of mp.aliases) hostIndex.set(a, mp.code);
}

export function isMarketplaceCode(value: unknown): value is MarketplaceCode {
  return typeof value === "string" && (MARKETPLACE_CODES as readonly string[]).includes(value);
}

export function getMarketplace(code: MarketplaceCode): Marketplace {
  return MARKETPLACES[code];
}

/** Exact-host lookup. Never suffix-matches, so `amazon.in.evil.com` is rejected. */
export function marketplaceForHost(host: string): MarketplaceCode | null {
  return hostIndex.get(host.toLowerCase().replace(/\.$/, "")) ?? null;
}

export function listingUrl(code: MarketplaceCode, asin: string): string {
  return `https://${MARKETPLACES[code].domain}/dp/${asin}`;
}
