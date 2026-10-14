"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Info, Layers, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import type { ReconcileResult } from "@/server/brand/reference";
import { AutoHeight } from "../motion/auto-height";
import { fadeTween } from "../motion/tokens";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Skeleton } from "../ui/empty-state";
import { BrandChoiceList, choiceBody, type BrandChoice, type BrandOption } from "./brand-choice";

/**
 * Change "My Brand". Choosing a brand first shows a dry-run of what will
 * change (comparisons created, renamed or archived; listings not yet
 * matched), and nothing is written until the person confirms.
 */
export function ChooseBrandDialog({ open, onOpenChange, current, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; current: { id: string; name: string } | null; onDone?: (r: { brand: { id: string; name: string } | null; reconcile: ReconcileResult }) => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<BrandChoice>(current ? { kind: "existing", id: current.id, name: current.name } : null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const body = choiceBody(choice);
  const deferred = useDeferredValue(body);
  const unchanged = choice?.kind === "existing" && choice.id === current?.id;

  const { data: brands } = useQuery({ queryKey: ["brands"], queryFn: () => api<{ brands: BrandOption[] }>("/api/brands"), enabled: open });
  const planKey = deferred ? ("brandId" in deferred ? `id:${deferred.brandId}` : `name:${deferred.brandName}`) : "none";
  const { data: plan, isFetching } = useQuery({
    queryKey: ["reference-plan", planKey],
    queryFn: () => api<{ plan: ReconcileResult }>(`/api/brands/reference?${deferred && "brandId" in deferred ? `brandId=${deferred.brandId}` : `brandName=${encodeURIComponent(deferred && "brandName" in deferred ? deferred.brandName : "")}`}`),
    enabled: open && Boolean(deferred) && !unchanged,
    staleTime: 10_000,
  });

  async function confirm() {
    if (!body) return;
    setBusy(true);
    try {
      const r = await api<{ brand: { id: string; name: string } | null; reconcile: ReconcileResult }>("/api/brands/reference", { method: "POST", body });
      const n = r.reconcile.cohorts.length;
      toast.success(`${r.brand?.name ?? "Your brand"} is now your brand`, { description: n ? `${n} comparison${n === 1 ? "" : "s"} kept in sync automatically.` : "Add a competitor in the same category to start comparing." });
      onDone?.(r);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't change your brand.");
    } finally {
      setBusy(false);
    }
  }

  const p = plan?.plan;
  const create = p?.cohorts.filter((c) => c.action === "create") ?? [];
  const update = p?.cohorts.filter((c) => c.action === "update") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Which brand is yours?" description="Aisle measures every competitor against this brand. You can change it at any time." size="md">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {brands ? (
          // A long brand list scrolls on its own so the impact preview below stays in view.
          <div className="-mx-1 max-h-[min(300px,40dvh)] overflow-y-auto px-1 py-1">
            <BrandChoiceList brands={brands.brands} value={choice} onChange={setChoice} newName={newName} onNewName={setNewName} compact />
          </div>
        ) : <div className="space-y-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] rounded-[12px]" />)}</div>}

        <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            {unchanged ? (
              <motion.p key="same" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={fadeTween} className="text-sm text-ink-3">
                {current?.name} is already your brand.
              </motion.p>
            ) : !body ? null : !p || isFetching ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="space-y-2 rounded-[14px] bg-surface-2 p-4 shadow-[var(--ring-inset)]" aria-live="polite">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </motion.div>
            ) : (
              <motion.div key={planKey} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={fadeTween} className="space-y-2.5 rounded-[14px] bg-surface-2 p-4 text-sm shadow-[var(--ring-inset)]" aria-live="polite">
                <div className="eyebrow">What changes</div>
                {p.cohorts.length === 0 ? (
                  <Line icon={<Info />} text={`No comparisons yet: nothing tracked shares a category and unit with ${p.brand?.name ?? "this brand"}. Add a competitor in the same category and Aisle builds the comparison for you.`} />
                ) : (
                  <Line
                    icon={<Layers />}
                    text={[create.length ? `${create.length} comparison${create.length === 1 ? "" : "s"} created` : null, update.length ? `${update.length} updated` : null, !create.length && !update.length ? `${p.cohorts.length} comparison${p.cohorts.length === 1 ? "" : "s"} unchanged` : null].filter(Boolean).join(", ")}
                    sub={p.cohorts.slice(0, 3).map((c) => c.name).join(" · ") + (p.cohorts.length > 3 ? ` · and ${p.cohorts.length - 3} more` : "")}
                  />
                )}
                {p.archived.length > 0 && <Line icon={<Archive />} text={`${p.archived.length} comparison${p.archived.length === 1 ? "" : "s"} archived (history kept)`} />}
                {p.unmatched.length > 0 && <Line icon={<Link2Off />} text={`${p.unmatched.length} listing${p.unmatched.length === 1 ? "" : "s"} not yet matched`} sub="Shown on the Brands page with what each one needs." />}
                {p.protection.enabled && <Line icon={<Info />} text="Protect My Brand alerts move to the new comparisons." />}
              </motion.div>
            )}
          </AnimatePresence>
        </AutoHeight>
      </div>
      <div className="flex items-center justify-end gap-2 px-6 py-4 hairline-t">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={!body || unchanged} onClick={confirm}>
          {body && !unchanged ? `Use ${choice?.name}` : "Choose a brand"}
        </Button>
      </div>
    </Dialog>
  );
}

function Line({ icon, text, sub }: { icon: React.ReactNode; text: string; sub?: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 text-ink-3 [&>svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-ink">{text}</div>
        {sub && <div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div>}
      </div>
    </div>
  );
}
