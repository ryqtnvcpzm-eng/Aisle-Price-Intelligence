/**
 * Provider request accounting hook. Adapters report every upstream call here;
 * the server wires it to the `provider_requests` table (see providers/index.ts).
 * Kept dependency-free so adapters stay unit-testable with fixtures.
 */
import type { ProviderId } from "./types";

export interface ProviderRequestLog {
  provider: ProviderId;
  operation: string;
  marketplace: string | null;
  itemCount: number;
  status: "ok" | "error" | "rate_limited" | "quota_exhausted" | "auth_error" | "timeout";
  httpStatus: number | null;
  durationMs: number;
  tokensConsumed: number | null;
  tokensLeft: number | null;
  error: string | null;
}

type Recorder = (log: ProviderRequestLog) => void | Promise<void>;
let recorder: Recorder | null = null;

export function setRequestRecorder(fn: Recorder | null) {
  recorder = fn;
}

export async function recordRequest(log: ProviderRequestLog) {
  try {
    await recorder?.(log);
  } catch {
    // Accounting must never break a refresh.
  }
}
