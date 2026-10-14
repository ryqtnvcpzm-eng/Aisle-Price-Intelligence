"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Download, Pause, Play, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import type { ImportJob, ImportJobItem } from "@/server/db/schema";
import type { JobCounts } from "@/server/catalog/bulk-import";
import { spring } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Segmented } from "../ui/segmented";
import { SimulatedBadge } from "../ui/status";

type Job = Omit<ImportJob, "createdAt" | "updatedAt" | "startedAt" | "finishedAt" | "leaseUntil"> & { createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null; leaseUntil: string | null };
type Item = Omit<ImportJobItem, "updatedAt"> & { updatedAt: string };
interface Snapshot {
  job: Job;
  counts: JobCounts;
  items: Item[];
}

type Filter = "all" | "failed" | "skipped" | "succeeded" | "pending";
const ACTIVE = new Set(["queued", "running"]);

export const JOB_STATUS: Record<string, { label: string; tone: "accent" | "good" | "warn" | "bad" | "neutral" }> = {
  queued: { label: "Queued", tone: "accent" },
  running: { label: "Importing", tone: "accent" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Finished", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Stopped", tone: "bad" },
};

const ITEM_STATUS: Record<string, { label: string; tone: "accent" | "good" | "warn" | "bad" | "neutral" }> = {
  pending: { label: "Waiting", tone: "neutral" },
  processing: { label: "Working", tone: "accent" },
  succeeded: { label: "Imported", tone: "good" },
  skipped: { label: "Skipped", tone: "neutral" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Stacked progress: imported, skipped and failed, out of the whole job. */
export function JobProgress({ counts, total, className }: { counts: JobCounts; total: number; className?: string }) {
  const seg = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className={cn("flex h-2 w-full overflow-hidden rounded-full bg-[var(--hairline)]", className)} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts.succeeded + counts.skipped + counts.failed + counts.cancelled} aria-label="Import progress">
      {[
        [counts.succeeded, "bg-good"],
        [counts.skipped, "bg-ink-4"],
        [counts.failed, "bg-bad"],
        [counts.cancelled, "bg-[var(--line-strong)]"],
      ].map(([n, c], i) => (
        <motion.span key={i} className={cn("h-full", c as string)} initial={false} animate={{ width: seg(n as number) }} transition={spring.layout} />
      ))}
    </div>
  );
}

/**
 * Progress page for one bulk import. While it's open it drives the job — one
 * chunk of 25 links per request — so imports run even without a background
 * worker; if a worker already holds the job, it just watches.
 */
export function ImportJobView({ initial }: { initial: Snapshot }) {
  const qc = useQueryClient();
  const id = initial.job.id;
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(100);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["import-job", id, filter, limit],
    queryFn: () => api<Snapshot>(`/api/import/jobs/${id}?limit=${limit}${filter === "all" ? "" : `&status=${filter}`}`),
    initialData: filter === "all" && limit === 100 ? initial : undefined,
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.job.status) ? 4000 : false),
  });
  const snap = data ?? initial;
  const { job, counts } = snap;
  const active = ACTIVE.has(job.status);
  const done = counts.succeeded + counts.skipped + counts.failed + counts.cancelled;

  // Drive the job while this page is visible.
  const driving = useRef(false);
  useEffect(() => {
    if (!active || driving.current) return;
    driving.current = true;
    let stop = false;
    (async () => {
      while (!stop) {
        if (document.visibilityState !== "visible") {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        try {
          const r = await api<{ status: string; processed: number; ran: boolean }>(`/api/import/jobs/${id}/process`, { method: "POST" });
          await qc.invalidateQueries({ queryKey: ["import-job", id] });
          if (!ACTIVE.has(r.status)) break;
          if (!r.ran || r.processed === 0) await new Promise((res) => setTimeout(res, 3000)); // someone else holds it
        } catch (e) {
          if (e instanceof ApiError && e.status === 429) await new Promise((res) => setTimeout(res, 5000));
          else {
            await new Promise((res) => setTimeout(res, 4000));
          }
        }
      }
      driving.current = false;
    })();
    return () => {
      stop = true;
      driving.current = false;
    };
  }, [active, id, qc]);

  async function act(action: "pause" | "resume" | "cancel" | "retry_failed") {
    setActing(action);
    try {
      await api(`/api/import/jobs/${id}`, { method: "POST", body: { action } });
      await qc.invalidateQueries({ queryKey: ["import-job", id] });
      if (action === "retry_failed") toast.success("Retrying the failed links");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setActing(null);
      setConfirmCancel(false);
    }
  }

  const st = JOB_STATUS[job.status] ?? JOB_STATUS.queued!;
  const opts = job.options;

  return (
    <div className="space-y-6">
      <Link href="/imports" className="inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> All imports
      </Link>

      <section className="card p-5 md:p-6" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          {job.isSimulated && <SimulatedBadge />}
          <span className="text-xs text-ink-3">Started {relativeTime(job.createdAt)} · {opts.variantPolicy === "all_variants" ? "all sizes & flavours" : "pasted listing only"} · {opts.intervalMinutes ? "monitored" : "not monitored yet"}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="num text-3xl font-semibold tracking-tight">
              {done.toLocaleString("en-IN")} <span className="text-lg font-normal text-ink-3">of {job.total.toLocaleString("en-IN")} links</span>
            </div>
            <div className="num mt-1 text-sm text-ink-2">
              {counts.succeeded.toLocaleString("en-IN")} imported · {counts.skipped} skipped · {counts.failed} failed{counts.cancelled ? ` · ${counts.cancelled} cancelled` : ""} · {counts.variantsAdded.toLocaleString("en-IN")} new variant{counts.variantsAdded === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <Button size="sm" loading={acting === "pause"} onClick={() => act("pause")}>
                <Pause className="size-3.5" /> Pause
              </Button>
            )}
            {job.status === "paused" && (
              <Button size="sm" variant="primary" loading={acting === "resume"} onClick={() => act("resume")}>
                <Play className="size-3.5" /> Resume
              </Button>
            )}
            {!active && counts.retryable > 0 && (
              <Button size="sm" loading={acting === "retry_failed"} onClick={() => act("retry_failed")}>
                <RotateCw className="size-3.5" /> Retry {counts.retryable} failed
              </Button>
            )}
            <a href={`/api/import/jobs/${id}/export`} download className="inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-sm font-medium text-ink shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)] transition-colors hover:bg-surface-2">
              <Download className="size-3.5" /> Export CSV
            </a>
            {(active || job.status === "paused") && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
                <X className="size-3.5" /> Cancel
              </Button>
            )}
          </div>
        </div>
        <JobProgress counts={counts} total={job.total} className="mt-4" />
        <p className="mt-3 text-xs text-ink-3">
          {active
            ? "Links are imported 25 at a time. Keep this page open to go faster; if you leave, the import continues when Aisle's background worker next runs."
            : job.status === "paused"
              ? (job.lastError ?? "Paused. Nothing more is imported until you resume.")
              : job.status === "completed"
                ? `Finished ${job.finishedAt ? relativeTime(job.finishedAt) : ""}. Your brand's comparisons were updated with the new products.`
                : (job.lastError ?? "")}
        </p>
        {job.status === "completed" && counts.succeeded > 0 && (
          <Link href="/products" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent">See your products <ArrowRight className="size-3.5" /></Link>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
          <h2 className="text-md font-semibold tracking-tight">Links</h2>
          <Segmented<Filter>
            ariaLabel="Filter links"
            size="sm"
            value={filter}
            onChange={(v) => { setFilter(v); setLimit(100); }}
            className="max-w-full overflow-x-auto no-scrollbar"
            options={[
              { value: "all", label: "All" },
              { value: "failed", label: `Failed ${counts.failed}` },
              { value: "skipped", label: `Skipped ${counts.skipped}` },
              { value: "succeeded", label: `Imported ${counts.succeeded}` },
              { value: "pending", label: `Waiting ${counts.pending + counts.processing}` },
            ]}
          />
        </div>
        <ul className="mt-3 divide-y divide-[var(--hairline)]">
          {snap.items.length === 0 && <li className="px-5 py-8 text-center text-sm text-ink-3">Nothing here.</li>}
          <AnimatePresence initial={false}>
            {snap.items.map((it) => {
              const s = ITEM_STATUS[it.status] ?? ITEM_STATUS.pending!;
              return (
                <motion.li key={it.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring.layout} className="flex items-start gap-3 px-5 py-2.5">
                  <span className="num w-10 shrink-0 pt-0.5 text-right text-2xs text-ink-4">{it.position + 1}</span>
                  <Badge tone={s.tone} size="xs" className="mt-0.5 w-[66px] justify-center">{s.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm" title={it.input}>{it.asin ? <><span className="num font-medium">{it.asin}</span> <span className="text-ink-3">{it.marketplace}</span></> : it.input}</div>
                    <div className="text-xs text-ink-3">
                      {it.status === "succeeded" ? `${it.newVariants} new variant${it.newVariants === 1 ? "" : "s"}${it.variantIds.length > it.newVariants ? `, ${it.variantIds.length - it.newVariants} already tracked` : ""}` : (it.error ?? (it.status === "processing" ? "Looking it up…" : ""))}
                    </div>
                  </div>
                  {it.familyId && (
                    <Link href={`/products/${it.familyId}`} className="shrink-0 text-xs font-medium text-accent">Open</Link>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        {snap.items.length >= limit && (
          <div className="px-5 py-3 hairline-t">
            <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 100)}>Show more</Button>
          </div>
        )}
      </section>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel} title="Cancel this import?" description={`${(counts.pending + counts.processing).toLocaleString("en-IN")} link(s) haven't been imported yet. Products already imported stay in your library.`} size="sm">
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep importing</Button>
          <Button variant="primary" className="bg-bad hover:bg-bad" loading={acting === "cancel"} onClick={() => act("cancel")}>Cancel import</Button>
        </div>
      </Dialog>
    </div>
  );
}
