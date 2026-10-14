/**
 * Queued bulk import (demo provider): chunks of 25, persistent per-link
 * results, lease-based concurrency, pause/resume/cancel/retry, crash recovery
 * and a CSV export that is safe to open in a spreadsheet.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHUNK_SIZE, createImportJob, exportJobCsv, getJob, jobAction, listItems, processImportJobs, processNextChunk } from "@/server/catalog/bulk-import";
import { listVariantRows } from "@/server/catalog/queries";
import { db, sqlClient } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getProvider } from "@/server/providers";
import type { DemoProvider } from "@/server/providers/demo";
import { getRedis, redisConfigured } from "@/server/redis";
import type { AppContext } from "@/server/workspace/context";
import { importFamily, makeContext } from "../support/fixtures";

let ctx: AppContext;
let other: AppContext;
// Placeholder ASINs: the demo provider answers for any well-formed ASIN with a simulated listing.
const asins = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `B0${prefix}${String(i).padStart(8 - prefix.length, "0")}`);

beforeAll(async () => {
  ctx = await makeContext("Bulk importer");
  other = await makeContext("Bystander");
  await importFamily(ctx, "https://www.amazon.in/dp/B0AISLE019"); // already tracked before the bulk import
});
afterAll(async () => {
  if (redisConfigured()) await getRedis().quit().catch(() => {});
  await sqlClient.end();
});

async function drain(jobId: string) {
  const sizes: number[] = [];
  for (let i = 0; i < 50; i++) {
    const r = await processNextChunk(jobId);
    if (r.processed) sizes.push(r.processed);
    if (r.status !== "queued" && r.status !== "running") return { sizes, last: r };
    if (!r.ran) throw new Error("lease unexpectedly held");
  }
  throw new Error("job did not drain");
}

describe("bulk import", () => {
  let jobId: string;

  it("queues every link and accounts for invalid and duplicate ones up front", async () => {
    const inputs = [...asins("BI", 60), "not-a-link", "B0BI000003", "https://www.amazon.in/dp/B0AISLE019", "=HYPERLINK(\"http://evil\")"];
    const job = await createImportJob(ctx, { inputs, variantPolicy: "pasted_only", intervalMinutes: 60 });
    jobId = job.id;
    const { counts } = await getJob(ctx.workspace.id, jobId);
    expect(job.total).toBe(64);
    expect(counts).toMatchObject({ pending: 61, failed: 2, skipped: 1 });
  });

  it("processes in chunks of at most 25 until done, with a result for every link", async () => {
    const { sizes, last } = await drain(jobId);
    expect(sizes.every((n) => n <= CHUNK_SIZE)).toBe(true);
    expect(sizes[0]).toBe(CHUNK_SIZE);
    expect(last.status).toBe("completed");
    const { counts } = await getJob(ctx.workspace.id, jobId);
    expect(counts).toMatchObject({ pending: 0, processing: 0, succeeded: 60, skipped: 2, failed: 2 });
    expect(counts.variantsAdded).toBe(60);
    const tracked = await listVariantRows(ctx.workspace.id);
    expect(tracked.filter((r) => r.asin.startsWith("B0BI"))).toHaveLength(60);
    const items = await listItems(ctx.workspace.id, jobId, { status: "skipped" });
    expect(items.map((i) => i.error).sort()).toEqual(["Already tracked in this workspace", "Same listing as row 4"]);
  });

  it("exports results as spreadsheet-safe CSV", async () => {
    const csv = await exportJobCsv(ctx.workspace.id, jobId);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("row,input,marketplace,asin,status,new_variants,variant_count,product_id,reason");
    expect(lines).toHaveLength(65);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).not.toMatch(/(^|,)"=/m);
  });

  it("lets only one process hold a job at a time", async () => {
    const job = await createImportJob(ctx, { inputs: asins("LK", 30), variantPolicy: "pasted_only", intervalMinutes: 60 });
    const [a, b] = await Promise.all([processNextChunk(job.id), processNextChunk(job.id)]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    await drain(job.id);
    expect((await getJob(ctx.workspace.id, job.id)).counts.succeeded).toBe(30);
  });

  it("pauses, resumes and cancels", async () => {
    const job = await createImportJob(ctx, { inputs: asins("PR", 60), variantPolicy: "pasted_only", intervalMinutes: null });
    await processNextChunk(job.id);
    await jobAction(ctx, job.id, "pause");
    expect((await processNextChunk(job.id)).ran).toBe(false);
    await jobAction(ctx, job.id, "resume");
    expect((await processNextChunk(job.id)).processed).toBe(CHUNK_SIZE);
    const { counts } = await jobAction(ctx, job.id, "cancel");
    expect(counts).toMatchObject({ succeeded: 50, cancelled: 10, pending: 0 });
    expect((await getJob(ctx.workspace.id, job.id)).job.status).toBe("cancelled");
    await expect(jobAction(ctx, job.id, "pause")).rejects.toMatchObject({ status: 409 });
    // Paused-then-imported listings honour the chosen schedule (null = not monitored).
    const rows = (await listVariantRows(ctx.workspace.id)).filter((r) => r.asin.startsWith("B0PR"));
    expect(rows.every((r) => r.intervalMinutes === null)).toBe(true);
  });

  it("re-queues transient provider failures, fails after three attempts, and retries on request", async () => {
    const demo = getProvider("demo") as DemoProvider;
    const job = await createImportJob(ctx, { inputs: asins("RT", 5), variantPolicy: "pasted_only", intervalMinutes: 60 });
    for (let i = 0; i < 3; i++) {
      demo.simulateFailure("upstream");
      await processNextChunk(job.id);
    }
    let { counts } = await getJob(ctx.workspace.id, job.id);
    expect(counts.failed).toBe(5);
    const failed = await listItems(ctx.workspace.id, job.id, { status: "failed" });
    expect(failed.every((f) => f.attempts === 3)).toBe(true);
    await jobAction(ctx, job.id, "retry_failed");
    await drain(job.id);
    ({ counts } = await getJob(ctx.workspace.id, job.id));
    expect(counts).toMatchObject({ succeeded: 5, failed: 0 });
  });

  it("recovers links left half-done by a crash", async () => {
    const job = await createImportJob(ctx, { inputs: asins("CR", 3), variantPolicy: "pasted_only", intervalMinutes: 60 });
    const [first] = await listItems(ctx.workspace.id, job.id);
    await db.update(s.importJobItems).set({ status: "processing", updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(s.importJobItems.id, first!.id));
    await drain(job.id);
    expect((await getJob(ctx.workspace.id, job.id)).counts.succeeded).toBe(3);
  });

  it("imports every discovered size and flavour with the all-variants policy", async () => {
    const job = await createImportJob(ctx, { inputs: ["https://www.amazon.in/dp/B0AISLE002"], variantPolicy: "all_variants", intervalMinutes: 60 });
    await processImportJobs({ maxChunks: 5 });
    const { counts } = await getJob(ctx.workspace.id, job.id);
    expect(counts.succeeded).toBe(1);
    expect(counts.variantsAdded).toBe(5);
  });

  it("keeps jobs private to their workspace", async () => {
    await expect(getJob(other.workspace.id, jobId)).rejects.toMatchObject({ status: 404 });
    await expect(jobAction(other, jobId, "cancel")).rejects.toMatchObject({ status: 404 });
    const mine = await db.select().from(s.importJobs).where(and(eq(s.importJobs.workspaceId, other.workspace.id)));
    expect(mine).toHaveLength(0);
  });
});
