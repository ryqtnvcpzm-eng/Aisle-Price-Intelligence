/**
 * Data freshness. Aisle tracks four distinct clocks and never conflates them:
 *  1. requestedAt         — when Aisle asked the provider
 *  2. providerUpdatedAt   — when the provider last refreshed its copy from Amazon
 *  3. observedAt          — the timestamp of the stored price observation
 *  4. render time         — when this screen was drawn
 * An hourly request does not mean Amazon's price was re-verified hourly.
 */

export type FreshnessState = "verified" | "provider_stale" | "pending" | "failed" | "paused" | "unavailable";

export interface FreshnessInput {
  intervalMinutes: number | null;
  lastSuccessAt: Date | string | null;
  lastFailureAt: Date | string | null;
  providerUpdatedAt: Date | string | null;
  nextCheckAt: Date | string | null;
  lastObservedAt: Date | string | null;
  consecutiveFailures: number;
  status?: string;
}

const t = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

/** Provider data older than this is called out even if our request succeeded. */
export const PROVIDER_STALE_MS = 6 * 3_600_000;

export function freshnessOf(f: FreshnessInput, now = Date.now()): FreshnessState {
  const success = t(f.lastSuccessAt);
  const failure = t(f.lastFailureAt);
  if (f.status === "not_found" || f.status === "invalid" || (!success && !t(f.lastObservedAt))) return "unavailable";
  if (failure && (!success || failure > success) && f.consecutiveFailures > 0) return "failed";
  if (f.intervalMinutes === null) return "paused";
  const intervalMs = f.intervalMinutes * 60_000;
  if (!success || now - success > intervalMs * 1.75) return "pending";
  const prov = t(f.providerUpdatedAt);
  if (prov && now - prov > Math.max(PROVIDER_STALE_MS, intervalMs * 2)) return "provider_stale";
  return "verified";
}

export const FRESHNESS_COPY: Record<FreshnessState, { label: string; description: string }> = {
  verified: { label: "Recently verified", description: "Checked on schedule and the provider's data is recent." },
  provider_stale: { label: "Provider data is older", description: "We checked recently, but the provider hasn't refreshed this listing from Amazon in a while." },
  pending: { label: "Refresh pending", description: "A scheduled check is due or in progress." },
  failed: { label: "Refresh failed", description: "The last check failed. Aisle retries automatically with backoff." },
  paused: { label: "Monitoring paused", description: "Scheduled checks are off for this listing." },
  unavailable: { label: "Data unavailable", description: "No usable observation exists yet." },
};

export function relativeTime(d: Date | string | number | null | undefined, now = Date.now()): string {
  if (d === null || d === undefined) return "never";
  const ms = now - new Date(d).getTime();
  const abs = Math.abs(ms);
  const fut = ms < 0;
  const fmt = (n: number, u: string) => (fut ? `in ${n}${u}` : `${n}${u} ago`);
  if (abs < 45_000) return fut ? "in a moment" : "just now";
  if (abs < 3_600_000) return fmt(Math.round(abs / 60_000), "m");
  if (abs < 86_400_000) return fmt(Math.round(abs / 3_600_000), "h");
  if (abs < 30 * 86_400_000) return fmt(Math.round(abs / 86_400_000), "d");
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Is background monitoring alive? The queue worker beats every 30 s; the
 * scheduled runner (`worker:once`, e.g. an hourly GitHub Actions cron) only
 * beats when it runs, and hosted crons can start late — allow two hours.
 */
export function workerAlive(hb: { at: string; mode?: "queue" | "scheduled" } | null | undefined, now: number): boolean {
  if (!hb) return false;
  const age = now - new Date(hb.at).getTime();
  return age < (hb.mode === "scheduled" ? 2 * 3600_000 : 120_000);
}
