/**
 * Amazon URL / ASIN parsing. Pure and client-safe so the import dialog can
 * give instant feedback while typing; the server re-runs the same parser
 * (never trusting the client) before any provider call.
 *
 * Canonical identity is `marketplace + ASIN` — never the raw URL.
 */
import { isMarketplaceCode, listingUrl, marketplaceForHost, type MarketplaceCode } from "./marketplaces";

/** Modern ASINs start with B0; books use their ISBN-10. */
const ASIN_RE = /^(?:B0[A-Z0-9]{8}|\d{9}[\dX])$/;

/** Shortener hosts we are willing to resolve server-side (exact match only). */
export const SHORT_LINK_HOSTS: Record<string, MarketplaceCode | null> = {
  "amzn.to": null,
  "a.co": null,
  "amzn.eu": null,
  "amzn.asia": null,
  "amzn.in": "IN",
};

/** Path patterns that carry an ASIN, most specific first. */
const PATH_PATTERNS: RegExp[] = [
  /\/dp\/(?:product\/)?([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/product\/(?:glance\/)?([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/gp\/offer-listing\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/exec\/obidos\/(?:tg\/detail\/-\/|ASIN\/)([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/o\/ASIN\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
  /\/product-reviews\/([A-Z0-9]{10})(?:[/?]|$)/i,
];

export type ParseErrorCode =
  | "empty"
  | "not_a_url"
  | "unsupported_host"
  | "unsupported_marketplace"
  | "no_asin"
  | "invalid_asin"
  | "insecure_scheme";

export type ParsedProductInput =
  | {
      kind: "listing";
      input: string;
      marketplace: MarketplaceCode;
      asin: string;
      canonicalUrl: string;
      /** Whether the marketplace came from the URL itself (vs. the user's default). */
      marketplaceDetected: boolean;
      source: "url" | "asin";
    }
  | { kind: "short_link"; input: string; url: string; host: string; marketplaceHint: MarketplaceCode | null }
  | { kind: "error"; input: string; code: ParseErrorCode; message: string };

export function isValidAsin(value: string): boolean {
  return ASIN_RE.test(value.toUpperCase());
}

export function normalizeAsin(value: string): string {
  return value.trim().toUpperCase();
}

const ERROR_COPY: Record<ParseErrorCode, string> = {
  empty: "Paste an Amazon product link or a 10-character ASIN.",
  not_a_url: "That doesn't look like a link or an ASIN.",
  unsupported_host: "Only Amazon product links can be imported. Other sites aren't fetched.",
  unsupported_marketplace: "This Amazon storefront isn't in Aisle's marketplace registry yet.",
  no_asin: "We recognised the Amazon storefront, but this link doesn't point to a single product page.",
  invalid_asin: "ASINs are 10 characters, usually starting with B0 (books use their ISBN-10).",
  insecure_scheme: "Only http(s) links are supported.",
};

function err(input: string, code: ParseErrorCode, message?: string): ParsedProductInput {
  return { kind: "error", input, code, message: message ?? ERROR_COPY[code] };
}

/** Extract the ASIN from an Amazon URL path or known query parameters. */
export function extractAsinFromUrl(url: URL): string | null {
  const path = decodeURIComponent(url.pathname);
  for (const re of PATH_PATTERNS) {
    const match = path.match(re);
    if (match?.[1]) {
      const asin = match[1].toUpperCase();
      if (ASIN_RE.test(asin)) return asin;
    }
  }
  for (const key of ["asin", "ASIN", "pd_rd_i"]) {
    const v = url.searchParams.get(key)?.toUpperCase();
    if (v && ASIN_RE.test(v)) return v;
  }
  // Legacy amzn.com/B0XXXXXXXX
  const bare = path.replace(/^\/+|\/+$/g, "").toUpperCase();
  if (ASIN_RE.test(bare)) return bare;
  return null;
}

function toUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/**
 * Parse a single pasted token (URL or ASIN).
 * @param defaultMarketplace used for bare ASINs or when the user has overridden detection.
 */
export function parseProductInput(raw: string, defaultMarketplace: MarketplaceCode): ParsedProductInput {
  const input = raw.trim();
  if (!input) return err(input, "empty");

  const upper = input.toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(upper)) {
    if (!ASIN_RE.test(upper)) return err(input, "invalid_asin");
    return {
      kind: "listing",
      input,
      marketplace: defaultMarketplace,
      asin: upper,
      canonicalUrl: listingUrl(defaultMarketplace, upper),
      marketplaceDetected: false,
      source: "asin",
    };
  }

  if (!input.includes(".") ) return err(input, "not_a_url");
  const url = toUrl(input);
  if (!url) return err(input, "not_a_url");
  if (url.protocol !== "https:" && url.protocol !== "http:") return err(input, "insecure_scheme");
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) {
    return err(input, "unsupported_host");
  }

  const host = url.hostname.toLowerCase();
  if (host in SHORT_LINK_HOSTS) {
    return { kind: "short_link", input, url: `https://${host}${url.pathname}`, host, marketplaceHint: SHORT_LINK_HOSTS[host] ?? null };
  }

  const marketplace = host === "amzn.com" || host === "www.amzn.com" ? "US" : marketplaceForHost(host);
  if (!marketplace) {
    // A real-looking Amazon storefront we don't list yet (amazon.cn, amazon.eg …) — not look-alikes like amazon.in.evil.com.
    if (/^(www\.|m\.)?amazon\.(com?\.)?[a-z]{2,3}$/.test(host)) return err(input, "unsupported_marketplace");
    return err(input, "unsupported_host");
  }

  const asin = extractAsinFromUrl(url);
  if (!asin) return err(input, "no_asin");
  return {
    kind: "listing",
    input,
    marketplace,
    asin,
    canonicalUrl: listingUrl(marketplace, asin),
    marketplaceDetected: true,
    source: "url",
  };
}

/** Split a pasted blob (newlines, spaces, commas) into individual candidate tokens. */
export function splitInputs(blob: string): string[] {
  return blob
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^[<("']+|[>)"']+$/g, ""))
    .filter(Boolean);
}

/**
 * Parse many inputs and collapse duplicates that point to the same listing
 * (same marketplace + ASIN), however different the raw URLs look.
 */
export function parseManyInputs(blob: string, defaultMarketplace: MarketplaceCode) {
  const seen = new Map<string, ParsedProductInput>();
  const results: (ParsedProductInput & { duplicateOf?: string })[] = [];
  for (const token of splitInputs(blob)) {
    const parsed = parseProductInput(token, defaultMarketplace);
    if (parsed.kind === "listing") {
      const key = `${parsed.marketplace}:${parsed.asin}`;
      if (seen.has(key)) {
        results.push({ ...parsed, duplicateOf: key });
        continue;
      }
      seen.set(key, parsed);
    }
    results.push(parsed);
  }
  return results;
}

export function listingKey(marketplace: MarketplaceCode, asin: string) {
  return `${marketplace}:${asin}`;
}

export function parseListingKey(key: string): { marketplace: MarketplaceCode; asin: string } | null {
  const [mp, asin] = key.split(":");
  if (!mp || !asin || !isMarketplaceCode(mp) || !isValidAsin(asin)) return null;
  return { marketplace: mp, asin };
}
