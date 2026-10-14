/**
 * Aisle background worker — a separate long-running process (never the web
 * server). Runs the monitoring scheduler, refresh batches, alert digests and
 * retention maintenance from a persistent BullMQ queue in Redis.
 *
 *   pnpm worker          # production
 *   pnpm worker:dev      # with file watching
 */
import "dotenv/config";
process.env.AISLE_SERVICE = "worker";

import { UnrecoverableError, Worker, type Job } from "bullmq";
import { evaluateSystemAlerts } from "../src/server/alerts/engine";
import { sendDigests } from "../src/server/alerts/deliver";
import { sqlClient } from "../src/server/db/client";
import { env } from "../src/server/env";
import { logger } from "../src/server/logger";
import { runMaintenance } from "../src/server/monitoring/maintenance";
import { processDueDeliveries } from "../src/server/notifications/email";
import { generateDueBriefings } from "../src/server/briefing/service";
import { writeHeartbeat } from "../src/server/monitoring/heartbeat";
import { getQueue, QUEUE_NAME, type RefreshJobData } from "../src/server/monitoring/queue";
import { runRefreshJob } from "../src/server/monitoring/refresh";
import { scanDueListings } from "../src/server/monitoring/scheduler";
import { ProviderError } from "../src/server/providers";
import { runScheduledReports } from "../src/server/reports/scheduled";
import { bullConnection, getRedis } from "../src/server/redis";

async function processJob(job: Job) {
  switch (job.name) {
    case "scan":
      return scanDueListings();
    case "refresh": {
      const { jobRowId } = job.data as RefreshJobData;
      const maxAttempts = job.opts.attempts ?? 1;
      try {
        return await runRefreshJob(jobRowId, { attempt: job.attemptsMade + 1, final: job.attemptsMade + 1 >= maxAttempts });
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw new UnrecoverableError(e.message);
        throw e;
      }
    }
    case "maintenance":
      return runMaintenance();
    case "digest": {
      await evaluateSystemAlerts();
      const day = new Date().getUTCDay();
      await sendDigests("daily");
      if (day === 1) await sendDigests("weekly");
      return { ok: true };
    }
    case "scheduled-reports":
      return runScheduledReports();
    case "deliveries":
      return processDueDeliveries();
    case "briefings":
      return generateDueBriefings();
    default:
      throw new UnrecoverableError(`Unknown job ${job.name}`);
  }
}

async function main() {
  if (!env.REDIS_URL) {
    logger.fatal("REDIS_URL is required for the long-running worker. On hosts without Redis, schedule `pnpm worker:once` hourly instead (see docs/DEPLOYMENT.md).");
    process.exit(1);
  }
  const queue = getQueue();
  // Idempotent schedulers: re-running the worker updates rather than duplicates them.
  await queue.upsertJobScheduler("scan-every-5m", { every: 5 * 60_000 }, { name: "scan", opts: { attempts: 1 } });
  await queue.upsertJobScheduler("system-alerts-hourly", { pattern: "7 * * * *" }, { name: "digest", opts: { attempts: 2 } });
  await queue.upsertJobScheduler("maintenance-daily", { pattern: "30 3 * * *" }, { name: "maintenance", opts: { attempts: 2 } });
  await queue.upsertJobScheduler("reports-daily", { pattern: "0 6 * * *" }, { name: "scheduled-reports", opts: { attempts: 2 } });
  // Idempotent: builds last week's briefing once per workspace (each in its own time zone), then no-ops.
  await queue.upsertJobScheduler("briefings-hourly", { pattern: "17 * * * *" }, { name: "briefings", opts: { attempts: 2 } });
  await queue.upsertJobScheduler("deliveries-every-2m", { every: 2 * 60_000 }, { name: "deliveries", opts: { attempts: 1 } });

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: bullConnection(),
    concurrency: env.MONITOR_CONCURRENCY,
    // Global ceiling on job starts; providers additionally enforce their own quotas.
    limiter: { max: 30, duration: 60_000 },
  });
  worker.on("completed", (job, result) => logger.debug({ job: job.name, id: job.id, result }, "job completed"));
  worker.on("failed", (job, err) => logger.warn({ job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }, "job failed"));
  worker.on("error", (err) => logger.error({ err }, "worker error"));

  const redis = getRedis();
  const beat = async () => {
    try {
      await writeHeartbeat("queue", 90);
    } catch {
      /* redis briefly unavailable */
    }
  };
  await beat();
  const heartbeat = setInterval(beat, 30_000);

  // Kick an immediate scan so a fresh deploy doesn't wait 5 minutes.
  await queue.add("scan", {}, { jobId: `scan-boot-${Math.floor(Date.now() / 60_000)}`, attempts: 1 });
  logger.info({ concurrency: env.MONITOR_CONCURRENCY }, "Aisle worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    clearInterval(heartbeat);
    await worker.close();
    await queue.close();
    await redis.quit().catch(() => {});
    await sqlClient.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.fatal({ err: e }, "worker failed to start");
  process.exit(1);
});
