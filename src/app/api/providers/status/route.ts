import { aiEnabled } from "@/server/ai/explain";
import { handle } from "@/server/http";
import { budgetSummary } from "@/server/monitoring/budget";
import { readHeartbeat } from "@/server/monitoring/heartbeat";
import { listRecentJobs } from "@/server/monitoring/scheduler";
import { activeProviderId, dataMode, getProvider, listProviders } from "@/server/providers";
import { redisConfigured } from "@/server/redis";
import { requireApiContext } from "@/server/workspace/context";
import { env } from "@/server/env";

export const GET = handle(async (req) => {
  await requireApiContext();
  const active = activeProviderId();
  const diagnose = req.nextUrl.searchParams.get("diagnose") === "1";
  const worker = await readHeartbeat();
  return {
    mode: dataMode(),
    active,
    providers: listProviders(),
    diagnosis: diagnose ? await getProvider(active).diagnose() : null,
    budget: await budgetSummary(active),
    demoBudget: active === "demo" ? null : await budgetSummary("demo"),
    worker,
    queue: redisConfigured() ? "bullmq" : "scheduled",
    jobs: (await listRecentJobs(15)).map((j) => ({ id: j.id, kind: j.kind, status: j.status, provider: j.provider, marketplace: j.marketplace, listings: j.listingIds.length, observations: j.observationsWritten, createdAt: j.createdAt, error: j.error })),
    ai: aiEnabled(),
    email: Boolean(env.RESEND_API_KEY),
    retentionDays: env.OBSERVATION_RETENTION_DAYS,
  };
});
