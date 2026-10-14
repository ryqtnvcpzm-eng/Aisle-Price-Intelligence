"use client";

import { motion } from "motion/react";
import { ArrowRight, FileUp } from "lucide-react";
import Link from "next/link";
import { relativeTime } from "@/lib/freshness";
import type { JobCounts } from "@/server/catalog/bulk-import";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { SimulatedBadge } from "../ui/status";
import { useImport } from "./import-context";
import { JOB_STATUS, JobProgress } from "./import-job-view";

interface Row {
  job: { id: string; status: string; total: number; createdAt: string; isSimulated: boolean; options: { variantPolicy: string } };
  counts: JobCounts;
}

export function ImportsIndex({ jobs }: { jobs: Row[] }) {
  const importer = useImport();
  if (!jobs.length) {
    return <EmptyState icon={<FileUp />} title="No bulk imports yet" description="Paste more than 25 links — or a CSV of them — in Add products, and Aisle imports them in the background, 25 at a time." action={<Button variant="primary" onClick={() => importer.open()}>Add products</Button>} />;
  }
  return (
    <ul className="space-y-3">
      {jobs.map(({ job, counts }, i) => {
        const st = JOB_STATUS[job.status] ?? JOB_STATUS.queued!;
        const done = counts.succeeded + counts.skipped + counts.failed + counts.cancelled;
        return (
          <motion.li key={job.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }}>
            <Link href={`/imports/${job.id}`} className="card group block p-4 transition-shadow hover:shadow-[var(--shadow-md),var(--ring-inset)]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={st.tone} size="xs">{st.label}</Badge>
                {job.isSimulated && <SimulatedBadge compact />}
                <span className="num text-sm font-medium">{done.toLocaleString("en-IN")} of {job.total.toLocaleString("en-IN")} links</span>
                <span className="text-xs text-ink-3">· {counts.succeeded} imported · {counts.failed} failed · {relativeTime(job.createdAt)}</span>
                <ArrowRight className="ml-auto size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" />
              </div>
              <JobProgress counts={counts} total={job.total} className="mt-3" />
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
