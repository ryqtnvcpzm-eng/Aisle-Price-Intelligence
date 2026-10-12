import "server-only";
import { Queue } from "bullmq";
import { bullConnection } from "../redis";

export const QUEUE_NAME = "aisle-monitoring";

export type JobName = "scan" | "refresh" | "maintenance" | "digest" | "scheduled-reports";
export interface RefreshJobData {
  jobRowId: string;
}

declare global {
  var __aisleQueue: Queue | undefined;
}

export function getQueue(): Queue {
  if (!globalThis.__aisleQueue) {
    globalThis.__aisleQueue = new Queue(QUEUE_NAME, {
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 2000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return globalThis.__aisleQueue;
}

/** Is a worker process alive? It writes this heartbeat every 30 seconds. */
export const HEARTBEAT_KEY = "aisle:worker:heartbeat";
