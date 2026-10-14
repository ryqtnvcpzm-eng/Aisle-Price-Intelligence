"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { BulkResult } from "@/server/catalog/bulk";
import { AutoHeight } from "../motion/auto-height";
import { fadeTween, spring } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { SuccessCheck } from "../ui/empty-state";
import { Field, Input } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";

export type BulkAction = "brand" | "frequency" | "tags";

const FREQUENCIES = [
  { value: "60", label: "Hourly" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "paused", label: "Paused" },
];

const TITLES: Record<BulkAction, string> = { brand: "Change brand", frequency: "Monitoring frequency", tags: "Edit tags" };

/**
 * One dialog for the three bulk edits. The form becomes the result in place:
 * how many were updated, and every skipped or failed item with its reason.
 */
export function BulkEditDialog({ action, onOpenChange, familyIds, variantIds, onDone }: { action: BulkAction | null; onOpenChange: (v: boolean) => void; familyIds: string[]; variantIds: string[]; onDone: () => void }) {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [frequency, setFrequency] = useState("60");
  const [mode, setMode] = useState<"add" | "remove" | "replace">("add");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const { data: brandList } = useQuery({ queryKey: ["brands"], queryFn: () => api<{ brands: { id: string; name: string }[] }>("/api/brands"), enabled: action === "brand" });

  const count = action === "frequency" ? variantIds.length : familyIds.length;
  const noun = action === "frequency" ? `variant${count === 1 ? "" : "s"}` : `product${count === 1 ? "" : "s"}`;
  const pendingTags = draft.trim() ? [...tags, draft.trim()] : tags;
  const valid = action === "brand" ? brand.trim().length > 0 : action === "tags" ? mode === "replace" || pendingTags.length > 0 : true;

  function addDraft() {
    const t = draft.trim().slice(0, 32);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags((x) => [...x, t].slice(0, 12));
    setDraft("");
  }

  async function apply() {
    if (!action) return;
    setBusy(true);
    try {
      const body =
        action === "brand"
          ? { action, familyIds, brandName: brand.trim() }
          : action === "frequency"
            ? { action, variantIds, intervalMinutes: frequency === "paused" ? null : Number(frequency) }
            : { action, familyIds, mode, tags: pendingTags };
      const r = await api<{ result: BulkResult }>("/api/bulk", { method: "POST", body });
      setResult(r.result);
      if (r.result.updated) {
        onDone();
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange} title={action ? TITLES[action] : ""} description={result ? undefined : `Applies to ${count} selected ${noun}.`} size="sm">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring.snappy} aria-live="polite">
                <div className="flex items-center gap-3">
                  {result.updated > 0 && result.failed.length === 0 ? <SuccessCheck size={36} /> : null}
                  <div>
                    <div className="text-md font-semibold">
                      {result.updated} of {result.requested} updated
                    </div>
                    <div className="text-xs text-ink-3">
                      {[result.skipped.length ? `${result.skipped.length} skipped` : null, result.failed.length ? `${result.failed.length} failed` : null].filter(Boolean).join(" · ") || "Nothing skipped or failed."}
                    </div>
                  </div>
                </div>
                {[...result.failed.map((o) => ({ ...o, kind: "failed" as const })), ...result.skipped.map((o) => ({ ...o, kind: "skipped" as const }))].length > 0 && (
                  <ul className="mt-4 max-h-[260px] space-y-1 overflow-y-auto rounded-[12px] bg-surface-2 p-2 shadow-[var(--ring-inset)]">
                    {[...result.failed.map((o) => ({ ...o, kind: "failed" as const })), ...result.skipped.map((o) => ({ ...o, kind: "skipped" as const }))].map((o) => (
                      <li key={`${o.kind}-${o.id}`} className="flex items-start gap-2 rounded-[8px] px-2 py-1.5 text-xs">
                        <Badge tone={o.kind === "failed" ? "bad" : "neutral"} size="xs" className="mt-px w-[52px] justify-center">{o.kind === "failed" ? "Failed" : "Skipped"}</Badge>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">{o.label}</span>
                          <span className="block text-ink-3">{o.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            ) : (
              <motion.div key={`form-${action}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={fadeTween} className="space-y-4">
                {action === "brand" && (
                  <Field label="Brand" hint="Pick an existing brand or type a new one. Comparisons for your brand update automatically." htmlFor="bulk-brand">
                    <Input id="bulk-brand" list="bulk-brand-list" autoFocus value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand name" maxLength={80} />
                    <datalist id="bulk-brand-list">{brandList?.brands.map((b) => <option key={b.id} value={b.name} />)}</datalist>
                  </Field>
                )}
                {action === "frequency" && (
                  <Field label="Check prices" hint="Shared listings are still polled once, at the most frequent schedule any workspace asks for.">
                    <Select ariaLabel="Monitoring frequency" className="w-full" value={frequency} onValueChange={setFrequency} options={FREQUENCIES} />
                  </Field>
                )}
                {action === "tags" && (
                  <>
                    <Segmented ariaLabel="Tag edit" size="sm" value={mode} onChange={setMode} options={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }, { value: "replace", label: "Replace all" }]} />
                    <Field label="Tags" hint={mode === "replace" ? "Leave empty to clear all tags." : "Press Enter or comma to add. Up to 12 per product."} htmlFor="bulk-tag">
                      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[10px] bg-surface px-2 py-1.5 shadow-[inset_0_0_0_0.5px_var(--line-strong),var(--shadow-xs)] focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]">
                        {tags.map((t) => (
                          <span key={t} className="flex h-6 items-center gap-1 rounded-full bg-accent-soft pl-2 pr-1 text-xs font-medium text-accent">
                            {t}
                            <button type="button" onClick={() => setTags((x) => x.filter((y) => y !== t))} className="flex size-4 items-center justify-center rounded-full hover:bg-accent hover:text-white" aria-label={`Remove ${t}`}>
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          id="bulk-tag"
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value.replace(",", ""))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addDraft();
                            } else if (e.key === "Backspace" && !draft && tags.length) setTags((x) => x.slice(0, -1));
                          }}
                          onBlur={addDraft}
                          maxLength={32}
                          placeholder={tags.length ? "" : "e.g. launch, Q4"}
                          className="h-6 min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4"
                        />
                      </div>
                    </Field>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </AutoHeight>
      </div>
      <div className={cn("flex items-center justify-end gap-2 px-6 py-4 hairline-t")}>
        {result ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!valid || count === 0} onClick={apply}>
              Apply to {count} {noun}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
