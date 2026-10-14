"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { AlertCircle, ArrowRight, ChevronDown, ClipboardPaste, ExternalLink, FileUp, Info, Link2, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { parseManyInputs, splitInputs } from "@/lib/amazon-url";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { getMarketplace, isMarketplaceCode, MARKETPLACES, PRIMARY_MARKETPLACES, listingUrl, type MarketplaceCode } from "@/lib/marketplaces";
import { formatMoney } from "@/lib/money";
import { formatQuantity, NORMALIZATION_BASES, type NormalizationBasis } from "@/lib/quantity";
import { AutoHeight } from "../motion/auto-height";
import { duration, ease, fadeTween, spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { ProductImage } from "../ui/product-image";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { SimulatedBadge, StockBadge } from "../ui/status";
import { Skeleton, SuccessCheck } from "../ui/empty-state";
import { useApp } from "../shell/app-context";
import type { ImportPreview, PreviewFamily } from "@/server/catalog/import";

type Phase = "input" | "loading" | "preview" | "saving" | "done" | "bulk";

interface GroupRow {
  id: string;
  name: string;
  managed_by: string | null;
}

/** Above this many links, one lookup isn't enough: the import is queued and processed 25 at a time. */
const BULK_THRESHOLD = 25;

const INTERVALS = [
  { value: "60", label: "Hourly" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "1440", label: "Daily" },
  { value: "paused", label: "Don't monitor yet" },
];

export function ImportDialog({ open, onOpenChange, prefill, groupId: initialGroupId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; prefill: string; groupId?: string; onDone?: (r: { familyIds: string[]; variantIds: string[]; groupId: string | null; brandIds?: string[] }) => void }) {
  const app = useApp();
  const router = useRouter();
  const [text, setText] = useState(prefill);
  const [mpOverride, setMpOverride] = useState<MarketplaceCode | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [brandOverrides, setBrandOverrides] = useState<Record<string, string>>({});
  /** The preview family whose brand the person marked as theirs ("This is my brand"). */
  const [mineKey, setMineKey] = useState<string | null>(null);
  const [mineSaved, setMineSaved] = useState<string | null>(null);
  const [groupChoice, setGroupChoice] = useState<string>(initialGroupId ?? "none");
  const [newGroupName, setNewGroupName] = useState("");
  const [interval, setIntervalChoice] = useState(String(app.workspace.settings.defaultIntervalMinutes ?? 60));
  const [showOrganize, setShowOrganize] = useState(Boolean(initialGroupId));
  const [result, setResult] = useState<{ familyIds: string[]; variantIds: string[]; groupId: string | null } | null>(null);
  const [bulkInputs, setBulkInputs] = useState<string[]>([]);
  const [policy, setPolicy] = useState<"pasted_only" | "all_variants">("pasted_only");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const defaultMp: MarketplaceCode = mpOverride ?? (isMarketplaceCode(app.workspace.defaultMarketplace) ? app.workspace.defaultMarketplace : "IN");
  const parsed = useMemo(() => (text.trim() ? parseManyInputs(text, defaultMp) : []), [text, defaultMp]);
  const valid = parsed.filter((p) => p.kind === "listing" || p.kind === "short_link");
  const detectedMp = parsed.find((p) => p.kind === "listing" && p.marketplaceDetected);
  const shownMp: MarketplaceCode = detectedMp && detectedMp.kind === "listing" ? detectedMp.marketplace : defaultMp;

  const { data: groups } = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: GroupRow[] }>("/api/groups"), enabled: open });
  // Managed "vs Market" comparisons fill themselves; products can only be added to your own comparisons.
  const ownGroups = (groups?.groups ?? []).filter((g) => !g.managed_by);
  const isBulk = valid.length > BULK_THRESHOLD;

  function startBulkSetup(tokens: string[]) {
    setBulkInputs(tokens);
    if (groupChoice === "new") setGroupChoice("none");
    setPhase("bulk");
  }

  async function startBulk() {
    setPhase("saving");
    try {
      const r = await api<{ job: { id: string } }>("/api/import/jobs", {
        method: "POST",
        body: { inputs: bulkInputs, variantPolicy: policy, intervalMinutes: interval === "paused" ? null : Number(interval), groupId: groupChoice !== "none" && groupChoice !== "new" ? groupChoice : null, marketplace: mpOverride ?? undefined },
      });
      onOpenChange(false);
      router.push(`/imports/${r.job.id}`);
    } catch (e) {
      setPhase("bulk");
      toast.error(e instanceof ApiError ? e.message : "Couldn't queue the import. Your links are still here.");
    }
  }

  // Auto-run when opened with a prefilled link (e.g. pasted into ⌘K).
  useEffect(() => {
    if (open && prefill.trim() && phase === "input") void lookup(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function lookup(input = text) {
    if (!input.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setPhase("loading");
    try {
      const res = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, marketplace: mpOverride }), signal: ac.signal });
      const json = await res.json();
      if (!res.ok) throw new ApiError(json.error?.message ?? "Lookup failed", res.status);
      const p = json as ImportPreview;
      setPreview(p);
      const sel: Record<string, Set<string>> = {};
      for (const f of p.families) {
        // Default: select every variant not already tracked; if all tracked, the pasted one.
        const fresh = f.variants.filter((v) => !v.alreadyTracked && v.status !== "no_data").map((v) => v.asin);
        sel[f.key] = new Set(fresh.length ? fresh : []);
      }
      setSelected(sel);
      setPhase(p.families.length ? "preview" : "input");
      if (!p.families.length) setError(p.errors[0]?.message ?? "Nothing could be imported from that.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof ApiError ? e.message : "We couldn't reach Aisle's server. Check your connection and try again.");
      setPhase("input");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase("input");
  }

  const totalSelected = Object.values(selected).reduce((s, x) => s + x.size, 0);

  async function save() {
    if (!preview || !totalSelected) return;
    setPhase("saving");
    try {
      const res = await api<{ familyIds: string[]; variantIds: string[]; groupId: string | null; brandIds?: string[] }>("/api/import/commit", {
        method: "POST",
        body: {
          previewId: preview.previewId,
          families: preview.families.filter((f) => selected[f.key]?.size).map((f) => ({ key: f.key, asins: [...selected[f.key]!], brandName: brandOverrides[f.key] || undefined })),
          groupId: groupChoice !== "none" && groupChoice !== "new" ? groupChoice : undefined,
          newGroupName: groupChoice === "new" && newGroupName.trim() ? newGroupName.trim() : undefined,
          intervalMinutes: interval === "paused" ? null : Number(interval),
        },
      });
      const mine = mineKey ? preview.families.find((f) => f.key === mineKey && selected[f.key]?.size) : null;
      const mineName = mine ? (brandOverrides[mine.key] || mine.brand || "").trim() : "";
      if (mineName && mineName !== app.referenceBrand?.name) {
        try {
          await api("/api/brands/reference", { method: "POST", body: { brandName: mineName } });
          setMineSaved(mineName);
        } catch {
          toast.error("Products were added, but your brand couldn't be saved. Set it on the Brands page.");
        }
      }
      setResult(res);
      setPhase("done");
      onDone?.(res);
      router.refresh();
    } catch (e) {
      setPhase("preview");
      toast.error(e instanceof ApiError ? e.message : "Saving failed. Your selection is still here — try again.");
    }
  }

  async function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.trim()) return;
    e.preventDefault();
    const next = text.trim() ? `${text.trim()}\n${pasted.trim()}` : pasted.trim();
    setText(next);
    // Parsing begins on paste; lookup follows instantly when the paste looks valid (bulk pastes wait for setup).
    const found = parseManyInputs(next, defaultMp).filter((p) => p.kind !== "error").length;
    if (found > 0 && found <= BULK_THRESHOLD) void lookup(next);
  }

  async function onFile(file: File) {
    const content = await file.text();
    // Accept any CSV/TSV/text: harvest every token that parses as an Amazon link or ASIN.
    const tokens = content.split(/[\s,;"']+/).filter((t) => t.length >= 10);
    const good = tokens.filter((t) => parseManyInputs(t, defaultMp)[0]?.kind !== "error");
    if (!good.length) return toast.error("No Amazon links or ASINs found in that file.");
    setText(good.join("\n"));
    if (good.length > BULK_THRESHOLD) return startBulkSetup(good);
    void lookup(good.join("\n"));
  }

  const title = phase === "done" ? "Monitoring started" : "Add products";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) abortRef.current?.abort(); onOpenChange(v); }} title={title} hideTitle size="lg" initialFocus="#import-input">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={phase === "done" ? "done" : "add"} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring.snappy}>
                <h2 className="text-xl font-semibold tracking-tight">{phase === "done" ? "You’re all set" : "Add products"}</h2>
                <p className="mt-0.5 text-sm text-ink-2">{phase === "done" ? "Aisle will keep these prices fresh in the background." : "Paste Amazon links or ASINs — one or many. We’ll find every variant."}</p>
              </motion.div>
            </AnimatePresence>
          </div>
          <button onClick={() => onOpenChange(false)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-[var(--hairline)] hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          {/* Phases swap sequentially (never two at once) while the sheet's height springs to fit. */}
          <AutoHeight>
          <AnimatePresence mode="wait" initial={false}>
            {(phase === "input" || phase === "loading") && (
              <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="space-y-3">
                <div className="relative">
                  <div className={cn("rounded-[14px] bg-surface-2 shadow-[inset_0_0_0_0.5px_var(--line-strong)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]", phase === "loading" && "opacity-70")}>
                    <div className="flex items-start gap-3 px-3.5 pt-3">
                      <Link2 className="mt-1 size-[18px] shrink-0 text-ink-3" />
                      <textarea
                        id="import-input"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onPaste={onPaste}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (isBulk) startBulkSetup(splitInputs(text));
                            else void lookup();
                          }
                        }}
                        rows={Math.min(6, Math.max(1, text.split("\n").length))}
                        placeholder="https://www.amazon.in/dp/B0…   or   B0…"
                        aria-label="Amazon product links or ASINs"
                        disabled={phase === "loading"}
                        className="min-h-[28px] flex-1 resize-none bg-transparent py-0.5 text-md text-ink outline-none placeholder:text-ink-4"
                      />
                    </div>
                    <div className="flex items-center gap-2 px-3 pb-2.5 pt-2">
                      <MarketplacePicker value={shownMp} detected={Boolean(detectedMp)} onChange={(m) => setMpOverride(m)} />
                      <span className="text-xs text-ink-3">{detectedMp ? "Detected from link" : "Used for bare ASINs"}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} title="Import a CSV of Amazon links">
                          <FileUp className="size-3.5" /> CSV
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              const t = await navigator.clipboard.readText();
                              if (t) {
                                setText(t);
                                if (parseManyInputs(t, defaultMp).filter((p) => p.kind !== "error").length > BULK_THRESHOLD) startBulkSetup(splitInputs(t));
                                else void lookup(t);
                              }
                            } catch {
                              toast("Press ⌘V / Ctrl+V to paste.");
                            }
                          }}
                        >
                          <ClipboardPaste className="size-3.5" /> Paste
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live parse feedback */}
                <AnimatePresence initial={false}>
                  {parsed.length > 0 && phase === "input" && (
                    <motion.ul initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.layout} className="space-y-1 overflow-hidden">
                      {parsed.slice(0, 8).map((p, i) => (
                        <li key={`${p.input}-${i}`} className="flex items-center gap-2 text-xs">
                          {p.kind === "listing" ? (
                            <>
                              <span className="size-1.5 rounded-full bg-good" />
                              <span className="text-ink-2">{getMarketplace(p.marketplace).flag}</span>
                              <span className="num font-medium text-ink">{p.asin}</span>
                              <span className="text-ink-3">on {getMarketplace(p.marketplace).name}</span>
                              {"duplicateOf" in p && p.duplicateOf && <Badge tone="neutral" size="xs">Duplicate — same listing</Badge>}
                            </>
                          ) : p.kind === "short_link" ? (
                            <>
                              <span className="size-1.5 rounded-full bg-accent" />
                              <span className="text-ink">{p.host}</span>
                              <span className="text-ink-3">short link — resolved securely on lookup</span>
                            </>
                          ) : (
                            <>
                              <span className="size-1.5 rounded-full bg-bad" />
                              <span className="max-w-[200px] truncate text-ink-2">{p.input}</span>
                              <span className="text-bad">{p.message}</span>
                            </>
                          )}
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>

                {error && phase === "input" && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5 rounded-[12px] bg-bad-soft px-3.5 py-3 text-sm text-ink" role="alert">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-bad" />
                    <div>
                      <div className="font-medium">{error}</div>
                      <div className="mt-0.5 text-xs text-ink-2">Check the link opens a single product page, or try the ASIN with the right marketplace selected.</div>
                    </div>
                  </motion.div>
                )}

                {phase === "loading" ? (
                  <LoadingPreview label={valid.length > 1 ? `Looking up ${valid.length} listings via ${app.providerLabel}…` : `Looking up the listing via ${app.providerLabel}…`} onCancel={cancel} />
                ) : (
                  app.dataMode === "demo" && (
                    <div className="rounded-[14px] bg-surface-2 p-3.5 shadow-[var(--ring-inset)]">
                      <div className="mb-2 flex items-center gap-2 text-xs text-ink-2">
                        <Sparkles className="size-3.5 text-sim" />
                        <span>
                          <span className="font-medium text-ink">Demo mode.</span> Try a sample listing from the simulated catalog:
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {app.sampleLinks.map((s) => (
                          <button
                            key={s.url}
                            onClick={() => {
                              setText(s.url);
                              void lookup(s.url);
                            }}
                            className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)] transition-colors hover:bg-accent-softer active:scale-[0.97]"
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                )}
              </motion.div>
            )}

            {(phase === "preview" || phase === "saving") && preview && (
              <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring.panel} className="space-y-4">
                <LayoutGroup>
                  {preview.families.map((f, fi) => (
                    <FamilyPreview
                      key={f.key}
                      family={f}
                      index={fi}
                      selected={selected[f.key] ?? new Set()}
                      onToggle={(asin, on) =>
                        setSelected((s) => {
                          const next = new Set(s[f.key]);
                          if (on) next.add(asin);
                          else next.delete(asin);
                          return { ...s, [f.key]: next };
                        })
                      }
                      onToggleAll={(on) => setSelected((s) => ({ ...s, [f.key]: new Set(on ? f.variants.filter((v) => v.status !== "no_data").map((v) => v.asin) : []) }))}
                      brand={brandOverrides[f.key] ?? f.brand ?? ""}
                      onBrand={(b) => setBrandOverrides((s) => ({ ...s, [f.key]: b }))}
                      referenceBrand={app.referenceBrand?.name ?? null}
                      mine={mineKey === f.key}
                      onMine={(on) => setMineKey(on ? f.key : null)}
                    />
                  ))}
                </LayoutGroup>

                {preview.errors.length > 0 && (
                  <div className="space-y-1.5 rounded-[12px] bg-warn-soft px-3.5 py-3">
                    <div className="text-xs font-semibold text-ink">{preview.errors.length} couldn’t be imported</div>
                    {preview.errors.map((e, i) => (
                      <div key={i} className="text-xs text-ink-2">
                        <span className="font-medium text-ink">{e.input.length > 48 ? `${e.input.slice(0, 46)}…` : e.input}</span> — {e.message}
                      </div>
                    ))}
                  </div>
                )}
                {preview.duplicates.length > 0 && <p className="text-xs text-ink-3">{preview.duplicates.length} duplicate link{preview.duplicates.length === 1 ? "" : "s"} pointed to a listing already in this import and were merged.</p>}

                {/* Organize — progressive disclosure */}
                <div className="rounded-[14px] bg-surface-2 shadow-[var(--ring-inset)]">
                  <button onClick={() => setShowOrganize((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium" aria-expanded={showOrganize}>
                    <span className="flex-1">Organize & monitor</span>
                    <span className="text-xs font-normal text-ink-3">{INTERVALS.find((i) => i.value === interval)?.label}{groupChoice !== "none" ? " · comparison" : ""}</span>
                    <motion.span animate={{ rotate: showOrganize ? 180 : 0 }} transition={spring.snappy}>
                      <ChevronDown className="size-4 text-ink-3" />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {showOrganize && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.layout} className="overflow-hidden">
                        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-ink-2" htmlFor="imp-group">Add to comparison</label>
                            <Select
                              id="imp-group"
                              ariaLabel="Comparison group"
                              className="w-full"
                              value={groupChoice}
                              onValueChange={setGroupChoice}
                              options={[{ value: "none", label: "None" }, { value: "new", label: "New comparison…" }, ...ownGroups.map((g) => ({ value: g.id, label: g.name }))]}
                            />
                            {groupChoice === "new" && <Input autoFocus placeholder="e.g. Plant Protein — India" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="mt-1.5 h-8 text-sm" aria-label="New comparison name" />}
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-ink-2" htmlFor="imp-int">Price checks</label>
                            <Select id="imp-int" ariaLabel="Monitoring interval" className="w-full" value={interval} onValueChange={setIntervalChoice} options={INTERVALS} />
                            <p className="text-2xs text-ink-3">Shared listings are polled once, even if other comparisons track them.</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {(phase === "bulk" || (phase === "saving" && !preview)) && (
              <motion.div key="bulk" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={spring.panel} className="space-y-4">
                <div className="rounded-[16px] bg-surface p-4 shadow-[var(--shadow-sm),var(--ring-inset)]">
                  <div className="num text-2xl font-semibold tracking-tight">{bulkInputs.length.toLocaleString("en-IN")} links</div>
                  <p className="mt-1 text-sm text-ink-2">
                    That’s more than one lookup can take, so Aisle will import them in the background, {BULK_THRESHOLD} at a time. You’ll see each link’s result — imported, skipped or failed, and why — and can pause, cancel or retry at any point.
                  </p>
                  {(() => {
                    const parsedBulk = parseManyInputs(bulkInputs.join("\n"), defaultMp);
                    const bad = parsedBulk.filter((p) => p.kind === "error").length;
                    const dupes = parsedBulk.filter((p) => "duplicateOf" in p && p.duplicateOf).length;
                    return bad || dupes ? <p className="mt-2 text-xs text-ink-3">{[bad ? `${bad} ${bad === 1 ? "doesn’t look like an Amazon link" : "don’t look like Amazon links"} and will be reported as failed` : null, dupes ? `${dupes} duplicate${dupes === 1 ? "" : "s"} will be skipped` : null].filter(Boolean).join(" · ")}.</p> : null;
                  })()}
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-ink-2">For each link, import</div>
                  <Segmented
                    ariaLabel="Variants to import"
                    size="sm"
                    value={policy}
                    onChange={setPolicy}
                    options={[
                      { value: "pasted_only", label: "Just that listing" },
                      { value: "all_variants", label: "Every size & flavour" },
                    ]}
                  />
                  <p className="text-2xs text-ink-3">{policy === "pasted_only" ? "One provider lookup per link — the fastest and lightest on your provider allowance." : "Also finds and imports each product's other sizes and flavours (more lookups per link)."}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-2" htmlFor="bulk-group">Add to comparison</label>
                    <Select id="bulk-group" ariaLabel="Comparison group" className="w-full" value={groupChoice === "new" ? "none" : groupChoice} onValueChange={setGroupChoice} options={[{ value: "none", label: "None" }, ...ownGroups.map((g) => ({ value: g.id, label: g.name }))]} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-2" htmlFor="bulk-int">Price checks</label>
                    <Select id="bulk-int" ariaLabel="Monitoring interval" className="w-full" value={interval} onValueChange={setIntervalChoice} options={INTERVALS} />
                  </div>
                </div>
              </motion.div>
            )}

            {phase === "done" && result && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={spring.popover} className="flex flex-col items-center px-4 py-10 text-center">
                <SuccessCheck size={52} />
                <h3 className="mt-5 text-xl font-semibold tracking-tight">
                  Tracking {result.variantIds.length} variant{result.variantIds.length === 1 ? "" : "s"}
                </h3>
                {mineSaved && <p className="mt-1.5 text-sm font-medium text-ink">{mineSaved} is now your brand.</p>}
                <p className="mt-1.5 max-w-[380px] text-sm text-ink-2">
                  {interval === "paused" ? "Monitoring is paused — turn it on from the product page whenever you're ready." : `First prices are saved. Aisle will check again ${INTERVALS.find((i) => i.value === interval)?.label.toLowerCase()} in the background.`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          </AutoHeight>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 hairline-t">
          {/* Footer actions swap in step with the body (same sequential timing), never ahead of it. */}
          <AnimatePresence mode="wait" initial={false}>
          <motion.div key={phase === "bulk" || (phase === "saving" && !preview) ? "bulk" : phase === "preview" || phase === "saving" ? "preview" : phase === "done" ? "done" : "input"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={fadeTween} className="flex items-center gap-2">
          {phase === "bulk" || (phase === "saving" && !preview) ? (
            <>
              <Button variant="ghost" onClick={() => setPhase("input")}>
                Back
              </Button>
              <Button variant="primary" size="lg" className="ml-auto" loading={phase === "saving"} onClick={startBulk}>
                Import {bulkInputs.length.toLocaleString("en-IN")} links <ArrowRight className="size-4" />
              </Button>
            </>
          ) : phase === "preview" || phase === "saving" ? (
            <>
              <Button variant="ghost" onClick={() => { setPhase("input"); setPreview(null); }}>
                Back
              </Button>
              <div className="ml-auto flex items-center gap-3">
                <span className="num hidden text-sm text-ink-3 sm:inline">{totalSelected} selected</span>
                <Button variant="primary" size="lg" loading={phase === "saving"} disabled={!totalSelected || (groupChoice === "new" && !newGroupName.trim())} onClick={save}>
                  Start monitoring <ArrowRight className="size-4" />
                </Button>
              </div>
            </>
          ) : phase === "done" && result ? (
            <>
              <Button variant="ghost" onClick={() => { setText(""); setPreview(null); setResult(null); setPhase("input"); }}>
                Add another
              </Button>
              <div className="ml-auto flex gap-2">
                {result.groupId && (
                  <Button onClick={() => { onOpenChange(false); router.push(`/comparisons/${result.groupId}`); }}>
                    Open comparison
                  </Button>
                )}
                <Button variant="primary" size="lg" onClick={() => { onOpenChange(false); router.push(result.familyIds.length === 1 ? `/products/${result.familyIds[0]}` : `/products?new=${result.familyIds.join(",")}`); }}>
                  View product{result.familyIds.length === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="hidden items-center gap-1.5 text-xs text-ink-3 sm:flex">
                <Info className="size-3.5" /> Data comes from {app.providerLabel}. Aisle never scrapes Amazon.
              </p>
              {isBulk ? (
                <Button variant="primary" size="lg" className="ml-auto" onClick={() => startBulkSetup(splitInputs(text))}>
                  Set up bulk import · {valid.length.toLocaleString("en-IN")} links
                </Button>
              ) : (
                <Button variant="primary" size="lg" className="ml-auto" disabled={!valid.length || phase === "loading"} onClick={() => lookup()}>
                  Find products
                </Button>
              )}
            </>
          )}
          </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Dialog>
  );
}

function MarketplacePicker({ value, detected, onChange }: { value: MarketplaceCode; detected: boolean; onChange: (m: MarketplaceCode) => void }) {
  return (
    <Select
      ariaLabel="Marketplace"
      size="sm"
      value={value}
      onValueChange={(v) => isMarketplaceCode(v) && onChange(v)}
      className={cn("h-7 gap-1.5 rounded-full pl-2 pr-2.5", detected && "shadow-[inset_0_0_0_1px_var(--accent)]")}
      options={PRIMARY_MARKETPLACES.map((m) => ({ value: m, label: `${MARKETPLACES[m].flag}  ${MARKETPLACES[m].domain.replace("www.", "")}`, hint: MARKETPLACES[m].currency }))}
    />
  );
}

function LoadingPreview({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: duration.page, ease: ease.out }} className="rounded-[16px] bg-surface p-4 shadow-[var(--shadow-sm),var(--ring-inset)]" aria-live="polite">
      <div className="flex gap-4">
        <Skeleton className="size-[88px] rounded-[14px]" />
        <div className="flex-1 space-y-2.5 pt-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-[10px]" style={{ opacity: 1 - i * 0.25 }} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-ink-2">{label}</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </motion.div>
  );
}

function FamilyPreview({ family: f, index, selected, onToggle, onToggleAll, brand, onBrand, referenceBrand, mine, onMine }: { family: PreviewFamily; index: number; selected: Set<string>; onToggle: (asin: string, on: boolean) => void; onToggleAll: (on: boolean) => void; brand: string; onBrand: (b: string) => void; referenceBrand: string | null; mine: boolean; onMine: (on: boolean) => void }) {
  const isReference = Boolean(referenceBrand && brand.trim() && brand.trim().toLowerCase() === referenceBrand.toLowerCase());
  const mp = isMarketplaceCode(f.marketplace) ? getMarketplace(f.marketplace) : null;
  const selectable = f.variants.filter((v) => v.status !== "no_data");
  const all = selectable.length > 0 && selectable.every((v) => selected.has(v.asin));
  const some = selectable.some((v) => selected.has(v.asin));
  const cheapest = [...f.variants].filter((v) => v.unitPriceMinor !== null).sort((a, b) => a.unitPriceMinor! - b.unitPriceMinor!)[0];
  const discoveryTone = f.discovery.completeness === "complete" ? "good" : f.discovery.completeness === "partial" ? "warn" : "neutral";
  const discoveryLabel = { complete: "All variants found", partial: "Partial discovery", unavailable: "Variants unavailable", single: "Single listing" }[f.discovery.completeness];

  return (
    <motion.section layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.panel, delay: staggerDelay(index, 0.08) }} className="overflow-hidden rounded-[16px] bg-surface shadow-[var(--shadow-sm),var(--ring-inset)]">
      <div className="flex gap-4 p-4">
        <ProductImage src={f.imageUrl} alt={f.title} size={88} rounded={14} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {f.isSimulated && <SimulatedBadge />}
            <Badge tone={discoveryTone} size="xs" title={f.discovery.note}>
              {discoveryLabel}
            </Badge>
            {f.existingFamilyId && <Badge tone="accent" size="xs">Already in library</Badge>}
          </div>
          <h3 className="mt-1.5 line-clamp-2 text-md font-semibold leading-snug tracking-tight">{f.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
            <input value={brand} onChange={(e) => onBrand(e.target.value)} placeholder="Brand" aria-label="Brand" className="w-[150px] rounded-[6px] bg-transparent px-1 py-0.5 -mx-1 font-medium text-ink-2 outline-none hover:bg-[var(--hairline)] focus:bg-surface-2 focus:shadow-[inset_0_0_0_1px_var(--accent)]" />
            {isReference ? (
              <Badge tone="accent" size="xs">Your brand</Badge>
            ) : (
              brand.trim() && (
                <button type="button" aria-pressed={mine} onClick={() => onMine(!mine)} className={cn("h-[18px] rounded-full px-2 text-2xs font-medium transition-colors", mine ? "bg-accent text-white" : "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line-strong)] hover:bg-[var(--hairline)]")}>
                  {mine ? "✓ My brand" : "This is my brand"}
                </button>
              )
            )}
            {mp && <span>{mp.flag} {mp.domain.replace("www.", "")}</span>}
            <span className="num">ASIN {f.primaryAsin}</span>
            {f.parentAsin && <span className="num">Parent {f.parentAsin}</span>}
          </div>
          <div className="mt-1 text-2xs text-ink-3">
            {f.categoryPath?.slice(-2).join(" › ")}
            {f.categoryPath ? " · " : ""}
            Provider updated {f.providerUpdatedAt ? relativeTime(f.providerUpdatedAt) : "— not reported"} · Requested {relativeTime(f.requestedAt)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-2 pt-1">
        <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={onToggleAll} label="Select all variants" />
        <span className="text-xs font-medium text-ink-2">
          {f.variants.length} variant{f.variants.length === 1 ? "" : "s"}
          {f.discovery.reportedTotal && f.discovery.reportedTotal > f.variants.length ? ` of ${f.discovery.reportedTotal} reported` : ""}
          {f.dimensions.length ? ` · by ${f.dimensions.join(", ").toLowerCase()}` : ""}
        </span>
        <span className="ml-auto text-2xs text-ink-3" title={f.discovery.note}>{f.discovery.note.length > 70 ? `${f.discovery.note.slice(0, 68)}…` : f.discovery.note}</span>
      </div>

      <ul className="px-2 pb-2" role="list">
        {f.variants.map((v, i) => {
          const on = selected.has(v.asin);
          const disabled = v.status === "no_data";
          const basis = v.unitBasis as NormalizationBasis | null;
          return (
            <motion.li
              key={v.asin}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.gentle, delay: 0.12 + staggerDelay(i, 0.045) }}
            >
              <label className={cn("group flex cursor-default items-center gap-3 rounded-[11px] px-2.5 py-2 transition-colors duration-150", on ? "bg-accent-softer" : "hover:bg-[var(--hairline)]", disabled && "opacity-50")}>
                <Checkbox checked={on} onCheckedChange={(c) => !disabled && onToggle(v.asin, c)} label={`Select ${v.label}`} />
                <ProductImage src={v.imageUrl} alt="" size={32} rounded={8} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{v.label}</span>
                    {v.isPrimary && <Badge tone="accent" size="xs">Pasted</Badge>}
                    {v.alreadyTracked && <Badge tone="neutral" size="xs" title={v.trackedInGroups.length ? `In ${v.trackedInGroups.join(", ")}` : undefined}>Tracked{v.trackedInGroups.length ? ` · ${v.trackedInGroups.length} group${v.trackedInGroups.length === 1 ? "" : "s"}` : ""}</Badge>}
                    {cheapest?.asin === v.asin && f.variants.length > 1 && <Badge tone="good" size="xs">Best unit value</Badge>}
                  </div>
                  <div className="num mt-0.5 flex items-center gap-2 text-2xs text-ink-3">
                    <span>{v.asin}</span>
                    <span title={v.quantity ? `Parsed from “${v.quantity.matchedText}” — unverified` : "Quantity couldn't be determined"}>{v.quantity ? formatQuantity(v.quantity) : "qty unknown"}</span>
                    {v.sellerName && <span className="hidden truncate sm:inline">{v.sellerIsAmazon ? "Sold by Amazon" : v.sellerName}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-sm font-semibold">{v.priceMinor !== null ? formatMoney(v.priceMinor, v.currency) : <span className="font-normal text-ink-4">No price</span>}</div>
                  <div className="num text-2xs text-ink-3">
                    {v.unitPriceMinor !== null && basis ? `${formatMoney(v.unitPriceMinor, v.currency, undefined, { trimZeros: false })}${NORMALIZATION_BASES[basis].label}` : v.listPriceMinor && v.priceMinor ? `List ${formatMoney(v.listPriceMinor, v.currency)}` : ""}
                  </div>
                </div>
                <div className="hidden w-[78px] justify-end sm:flex">
                  <StockBadge availability={v.availability} />
                </div>
                <a href={isMarketplaceCode(f.marketplace) ? listingUrl(f.marketplace, v.asin) : "#"} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="hidden size-7 items-center justify-center rounded-[7px] text-ink-4 opacity-0 transition-opacity hover:bg-[var(--hairline)] hover:text-ink group-hover:opacity-100 sm:flex" aria-label={`Open ${v.asin} on Amazon`}>
                  <ExternalLink className="size-3.5" />
                </a>
              </label>
            </motion.li>
          );
        })}
      </ul>
    </motion.section>
  );
}
