import "server-only";
import { and, eq, min, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { providerQuotas, providerRequests } from "../db/schema";
import { env } from "../env";
import { logger } from "../logger";
import { setRequestRecorder } from "./accounting";
import { CreatorsProvider } from "./creators";
import { DemoProvider } from "./demo";
import type { DataProvider, ProviderId } from "./types";

export * from "./types";

declare global {
  var __aisleProviders: Map<ProviderId, DataProvider> | undefined;
}
const instances: Map<ProviderId, DataProvider> = (globalThis.__aisleProviders ??= new Map());

export function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

setRequestRecorder(async (log) => {
  await db.insert(providerRequests).values({
    provider: log.provider,
    operation: log.operation,
    marketplace: log.marketplace,
    itemCount: log.itemCount,
    status: log.status,
    httpStatus: log.httpStatus,
    durationMs: log.durationMs,
    tokensConsumed: log.tokensConsumed,
    tokensLeft: log.tokensLeft,
    error: log.error,
  });
  const mk = monthKey();
  await db
    .insert(providerQuotas)
    .values({
      provider: log.provider,
      tokensLeft: log.tokensLeft,
      monthKey: mk,
      tokensUsedMonth: log.tokensConsumed ?? 0,
      requestsMonth: 1,
    })
    .onConflictDoUpdate({
      target: providerQuotas.provider,
      set: {
        tokensLeft: log.tokensLeft ?? sql`${providerQuotas.tokensLeft}`,
        // Reset counters when the calendar month rolls over.
        tokensUsedMonth: sql`case when ${providerQuotas.monthKey} = ${mk} then ${providerQuotas.tokensUsedMonth} else 0 end + ${log.tokensConsumed ?? 0}`,
        requestsMonth: sql`case when ${providerQuotas.monthKey} = ${mk} then ${providerQuotas.requestsMonth} else 0 end + 1`,
        monthKey: mk,
        updatedAt: new Date(),
      },
    });
});

export function isCreatorsConfigured() {
  return Boolean(env.CREATORS_API_CREDENTIAL_ID && env.CREATORS_API_CREDENTIAL_SECRET && env.CREATORS_API_CREDENTIAL_VERSION && env.CREATORS_API_PARTNER_TAG);
}

export function getProvider(id: ProviderId): DataProvider {
  const existing = instances.get(id);
  if (existing) return existing;
  let p: DataProvider;
  switch (id) {
    case "creators":
      if (!isCreatorsConfigured()) throw new Error("Creators API credentials are not configured");
      p = new CreatorsProvider({
        credentialId: env.CREATORS_API_CREDENTIAL_ID!,
        credentialSecret: env.CREATORS_API_CREDENTIAL_SECRET!,
        version: env.CREATORS_API_CREDENTIAL_VERSION!,
        partnerTag: env.CREATORS_API_PARTNER_TAG!,
        licenseAck: env.CREATORS_API_LICENSE_ACK === "true",
      });
      break;
    case "demo":
      p = new DemoProvider();
      break;
  }
  instances.set(id, p);
  return p;
}

/** The provider used for new imports. */
export function activeProviderId(): ProviderId {
  switch (env.DATA_PROVIDER) {
    case "creators":
    case "demo":
      return env.DATA_PROVIDER;
    default:
      if (isCreatorsConfigured()) return "creators";
      return "demo";
  }
}

export function getActiveProvider(): DataProvider {
  const id = activeProviderId();
  try {
    return getProvider(id);
  } catch (e) {
    logger.warn({ err: e, provider: id }, "configured provider unavailable; falling back to demo");
    return getProvider("demo");
  }
}

export function dataMode(): "demo" | "live" {
  return getActiveProvider().isSimulated ? "demo" : "live";
}

/**
 * When did each real provider first return a successful response in this
 * deployment? Until then its adapter is only fixture-tested, and the UI says so
 * instead of presenting live tracking as operational.
 */
export async function liveVerification(): Promise<Partial<Record<ProviderId, string | null>>> {
  const rows = await db
    .select({ provider: providerRequests.provider, first: min(providerRequests.createdAt) })
    .from(providerRequests)
    .where(and(eq(providerRequests.status, "ok"), ne(providerRequests.provider, "demo")))
    .groupBy(providerRequests.provider);
  const out: Partial<Record<ProviderId, string | null>> = { creators: null };
  for (const r of rows) out[r.provider as ProviderId] = r.first ? new Date(r.first).toISOString() : null;
  return out;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  configured: boolean;
  active: boolean;
  simulated: boolean;
  capabilities: DataProvider["capabilities"] | null;
  note: string;
}

export function listProviders(): ProviderInfo[] {
  const active = activeProviderId();
  const info = (id: ProviderId, configured: boolean, note: string): ProviderInfo => {
    let p: DataProvider | null = null;
    try {
      p = configured ? getProvider(id) : null;
    } catch {
      p = null;
    }
    return { id, label: p?.label ?? (id === "creators" ? "Amazon Creators API" : "Demo"), configured, active: active === id, simulated: id === "demo", capabilities: p?.capabilities ?? null, note };
  };
  return [
    info(
      "creators",
      isCreatorsConfigured(),
      env.CREATORS_API_LICENSE_ACK === "true"
        ? "Amazon’s free Associates API. Monitoring enabled by operator acknowledgement of the Associates agreement."
        : "Amazon’s free Associates API. Used for lookups only; scheduled price storage stays off unless your agreement permits it (CREATORS_API_LICENSE_ACK).",
    ),
    info("demo", true, "Fictional catalog with simulated prices. Always available; every value is labelled simulated."),
  ];
}
