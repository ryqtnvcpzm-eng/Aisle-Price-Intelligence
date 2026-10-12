"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";

type JobStatus = { id: string; status: string; error: string | null; observationsWritten: number };

/**
 * Manual refresh: enqueue jobs, poll their status, then re-render the server
 * data so changed prices animate in. Unchanged prices don't animate.
 */
export function useRefresh() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "queued" | "running">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(
    async (variantIds: string[]) => {
      if (!variantIds.length) return;
      setState("queued");
      try {
        const { jobIds, listings } = await api<{ jobIds: string[]; listings: number }>("/api/refresh", { method: "POST", body: { variantIds } });
        if (!jobIds.length) {
          setState("idle");
          toast("A refresh for these listings was just requested — results arrive shortly.");
          return;
        }
        const started = Date.now();
        const poll = async () => {
          const { jobs } = await api<{ jobs: JobStatus[] }>(`/api/refresh?ids=${jobIds.join(",")}`);
          const done = jobs.length > 0 && jobs.every((j) => ["succeeded", "partial", "failed", "skipped"].includes(j.status));
          if (jobs.some((j) => j.status === "running")) setState("running");
          if (done || Date.now() - started > 90_000) {
            setState("idle");
            router.refresh();
            const failed = jobs.filter((j) => j.status === "failed");
            if (!done) toast("Refresh is taking longer than usual. The worker will finish it in the background.");
            else if (failed.length) toast.error("The provider couldn't refresh some listings", { description: failed[0]?.error ?? undefined });
            else toast.success(`Refreshed ${listings} listing${listings === 1 ? "" : "s"}`, { description: `${jobs.reduce((s, j) => s + j.observationsWritten, 0)} new observation(s) stored.` });
            return;
          }
          timer.current = setTimeout(poll, 1200);
        };
        timer.current = setTimeout(poll, 600);
      } catch (e) {
        setState("idle");
        toast.error(e instanceof ApiError ? e.message : "Couldn't start the refresh.");
      }
    },
    [router],
  );

  return { refresh, refreshing: state !== "idle", state };
}
