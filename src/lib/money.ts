/**
 * Money is always an integer count of minor units (paise, cents, yen) plus an
 * ISO currency code. Floating point is only used when *formatting* for display
 * or when computing dimensionless ratios (percent changes) — never for sums.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, CLP: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

const formatterCache = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, locale: string, opts: { compact?: boolean; decimals?: number }) {
  const key = `${currency}|${locale}|${opts.compact ? 1 : 0}|${opts.decimals ?? "auto"}`;
  let f = formatterCache.get(key);
  if (!f) {
    const exp = currencyExponent(currency);
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      minimumFractionDigits: opts.decimals ?? (opts.compact ? 0 : exp),
      maximumFractionDigits: opts.decimals ?? (opts.compact ? 1 : exp),
    });
    formatterCache.set(key, f);
  }
  return f;
}

export function minorToMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyExponent(currency);
}

export function majorToMinor(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyExponent(currency));
}

/** Format integer minor units. Whole-unit prices drop trailing ".00" for calm tables. */
const CURRENCY_LOCALE: Record<string, string> = { INR: "en-IN", USD: "en-US", CAD: "en-CA", GBP: "en-GB", EUR: "en-IE", JPY: "ja-JP", AUD: "en-AU", AED: "en-AE", MXN: "es-MX", BRL: "pt-BR", SEK: "sv-SE", PLN: "pl-PL", SGD: "en-SG", SAR: "en-SA", TRY: "tr-TR" };

/** A locale that renders the currency the way its home marketplace does (₹1,19,999 · $1,199.99). */
export function localeForCurrency(currency: string): string {
  return CURRENCY_LOCALE[currency] ?? "en-US";
}

export function formatMoney(
  amountMinor: number | null | undefined,
  currency: string,
  locale?: string,
  opts: { compact?: boolean; trimZeros?: boolean; decimals?: number } = {},
): string {
  if (amountMinor === null || amountMinor === undefined || Number.isNaN(amountMinor)) return "—";
  const exp = currencyExponent(currency);
  const whole = exp === 0 || amountMinor % 10 ** exp === 0;
  const decimals = opts.decimals ?? (opts.trimZeros !== false && whole ? 0 : undefined);
  return formatter(currency, locale ?? localeForCurrency(currency), { compact: opts.compact, decimals }).format(minorToMajor(amountMinor, currency));
}

export function formatSignedMoney(deltaMinor: number, currency: string, locale?: string) {
  const sign = deltaMinor > 0 ? "+" : deltaMinor < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(deltaMinor), currency, locale)}`;
}

/** Ratio change, e.g. 0.052 for +5.2%. Null when the base is missing or zero. */
export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined || from === 0) return null;
  return (to - from) / from;
}

export function formatPct(ratio: number | null | undefined, opts: { signed?: boolean; decimals?: number } = {}) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const decimals = opts.decimals ?? (Math.abs(ratio) < 0.1 ? 1 : 0);
  const v = Math.abs(ratio * 100).toFixed(decimals);
  if (!opts.signed) return `${ratio < 0 ? "−" : ""}${v}%`;
  if (Number(v) === 0) return `0%`;
  return `${ratio > 0 ? "+" : "−"}${v}%`;
}

/**
 * Integer division with round-half-up, done in BigInt so large
 * numerators (price × reference quantity) never lose precision.
 */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("division by zero");
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return neg ? -q : q;
}

/** Median of integer amounts; returns integer minor units (half-up between middles). */
export function medianMinor(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid]!;
  return Number(divRound(BigInt(s[mid - 1]!) + BigInt(s[mid]!), 2n));
}
