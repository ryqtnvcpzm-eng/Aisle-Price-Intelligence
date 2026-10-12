import "server-only";
import { parseProductInput, SHORT_LINK_HOSTS, type ParsedProductInput } from "@/lib/amazon-url";
import { marketplaceForHost, type MarketplaceCode } from "@/lib/marketplaces";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Resolve Amazon short links (amzn.to, a.co, amzn.eu, amzn.asia, amzn.in) to a
 * product URL — safely:
 *  - only https, only exact-match allowlisted hosts at *every* hop
 *  - redirects followed manually (max 5), never automatically
 *  - HEAD first, no body read, 5s timeout per hop, credentials never sent
 * Any hop leaving the allowlist aborts resolution, so this can't be used to
 * probe internal networks (SSRF) or arbitrary sites.
 */
const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 5000;

function isAllowedHost(host: string) {
  return host in SHORT_LINK_HOSTS || marketplaceForHost(host) !== null;
}

export type ResolveFailure = "disabled" | "blocked_redirect" | "too_many_redirects" | "timeout" | "network" | "no_product";

export async function resolveShortLink(
  url: string,
  defaultMarketplace: MarketplaceCode,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProductInput | { kind: "error"; input: string; code: ResolveFailure; message: string }> {
  if (env.ALLOW_SHORT_LINK_RESOLUTION !== "true") {
    return { kind: "error", input: url, code: "disabled", message: "Short-link resolution is turned off. Paste the full Amazon product link instead." };
  }
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (current.protocol !== "https:" || !isAllowedHost(current.hostname.toLowerCase()) || current.username || current.password || current.port) {
      logger.warn({ host: current.hostname, hop }, "short link redirected outside allowlist");
      return { kind: "error", input: url, code: "blocked_redirect", message: "That short link redirects somewhere other than Amazon, so we stopped following it." };
    }
    // Reached a storefront: parse it directly without fetching the page.
    if (marketplaceForHost(current.hostname)) {
      const parsed = parseProductInput(current.toString(), defaultMarketplace);
      if (parsed.kind === "listing") return { ...parsed, input: url };
      return { kind: "error", input: url, code: "no_product", message: "The short link opened an Amazon page that isn't a single product." };
    }
    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: "HEAD",
        redirect: "manual",
        credentials: "omit",
        headers: { "User-Agent": "AisleLinkResolver/1.0 (+https://github.com/)" },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { kind: "error", input: url, code: timeout ? "timeout" : "network", message: timeout ? "The short link took too long to respond." : "We couldn't reach the short-link service. Paste the full Amazon link instead." };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) {
      return { kind: "error", input: url, code: "no_product", message: "That short link didn't redirect to an Amazon product." };
    }
    current = new URL(location, current);
  }
  return { kind: "error", input: url, code: "too_many_redirects", message: "That short link redirected too many times." };
}
