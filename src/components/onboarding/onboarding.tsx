"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, BarChart3, Bell, Check, Layers, Link2, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MARKETPLACES, PRIMARY_MARKETPLACES, type MarketplaceCode } from "@/lib/marketplaces";
import { duration, spring, staggerDelay } from "../motion/tokens";
import { ImportProvider, useImport, type ImportResult } from "../import/import-context";
import { AppInfoProvider, type AppInfo } from "../shell/app-context";
import { Logo } from "../shell/logo";
import { PreferencesProvider } from "../shell/preferences";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

const STEPS = ["welcome", "marketplace", "products", "compare"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding({ info }: { info: AppInfo }) {
  return (
    <AppInfoProvider value={info}>
      <PreferencesProvider initialSidebarCollapsed={false} initialMarketplace={null}>
        <ImportProvider>
          <Flow info={info} />
        </ImportProvider>
      </PreferencesProvider>
    </AppInfoProvider>
  );
}

function Flow({ info }: { info: AppInfo }) {
  const router = useRouter();
  const importer = useImport();
  const [step, setStep] = useState<Step>("welcome");
  const [dir, setDir] = useState(1);
  const [mp, setMp] = useState<MarketplaceCode>((info.workspace.defaultMarketplace as MarketplaceCode) ?? "IN");
  const [imports, setImports] = useState<ImportResult[]>([]);
  const [groupName, setGroupName] = useState("");
  const [hourly, setHourly] = useState(true);
  const [busy, setBusy] = useState(false);
  const idx = STEPS.indexOf(step);
  const variantIds = imports.flatMap((r) => r.variantIds);

  const go = (s: Step) => {
    setDir(STEPS.indexOf(s) > idx ? 1 : -1);
    setStep(s);
  };

  async function finish(skip = false) {
    setBusy(true);
    try {
      await api("/api/workspace", { method: "PATCH", body: { onboarded: true, defaultMarketplace: mp } });
      let groupId: string | null = null;
      if (!skip && variantIds.length >= 2 && groupName.trim()) {
        const r = await api<{ group: { id: string } }>("/api/groups", { method: "POST", body: { name: groupName.trim(), variantIds } });
        groupId = r.group.id;
      }
      if (!skip && !hourly && variantIds.length) await api("/api/variants", { method: "PATCH", body: { ids: variantIds, patch: { intervalMinutes: 1440 } } });
      router.push(groupId ? `/comparisons/${groupId}` : "/");
      router.refresh();
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Couldn't finish setup.");
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_0%,var(--accent-softer),transparent_70%)]" />
      <header className="relative flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-[15px] font-semibold tracking-tight">Aisle</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => finish(true)} disabled={busy}>
          Skip setup
        </Button>
      </header>

      <div className="relative mx-auto flex w-full max-w-[640px] flex-1 flex-col px-6 pb-10">
        {/* Progress */}
        <div className="mb-10 mt-4 flex items-center gap-1.5" aria-label={`Step ${idx + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <div key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
              <motion.div className="h-full rounded-full bg-accent" initial={false} animate={{ width: i <= idx ? "100%" : "0%" }} transition={spring.layout} />
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -16, transition: { duration: duration.micro } }}
            transition={spring.panel}
            className="flex-1"
          >
            {step === "welcome" && (
              <div className="flex flex-col items-center pt-6 text-center">
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.popover, delay: 0.05 }}>
                  <Logo size={72} />
                </motion.div>
                <h1 className="mt-8 text-4xl font-semibold tracking-tight">Welcome to Aisle</h1>
                <p className="mt-3 max-w-[460px] text-lg text-ink-2">See every competitor's price — per variant, per gram, over time — without lifting a finger.</p>
                <ul className="mt-10 grid w-full gap-3 text-left sm:grid-cols-3">
                  {[
                    { icon: Link2, t: "Paste a link", d: "We find every size and flavour." },
                    { icon: BarChart3, t: "Compare fairly", d: "Unit prices across pack sizes." },
                    { icon: Bell, t: "Know overnight", d: "Hourly checks and calm alerts." },
                  ].map((f, i) => (
                    <motion.li key={f.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 0.15 + staggerDelay(i, 0.06) }} className="card p-4">
                      <f.icon className="size-5 text-accent" />
                      <div className="mt-3 text-sm font-semibold">{f.t}</div>
                      <div className="mt-0.5 text-xs text-ink-2">{f.d}</div>
                    </motion.li>
                  ))}
                </ul>
                <Button variant="primary" size="lg" className="mt-10 min-w-[200px]" onClick={() => go("marketplace")}>
                  Get started <ArrowRight className="size-4" />
                </Button>
              </div>
            )}

            {step === "marketplace" && (
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">Where do you sell?</h2>
                <p className="mt-2 text-md text-ink-2">Your default Amazon marketplace. Links from other storefronts are detected automatically.</p>
                <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRIMARY_MARKETPLACES.map((m, i) => {
                    const on = m === mp;
                    return (
                      <motion.button
                        key={m}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...spring.gentle, delay: staggerDelay(i, 0.025) }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setMp(m)}
                        aria-pressed={on}
                        className={cn("relative flex items-center gap-3 rounded-[14px] p-3.5 text-left transition-shadow", on ? "bg-surface shadow-[0_0_0_2px_var(--accent),var(--shadow-md)]" : "bg-surface shadow-[var(--shadow-sm),var(--ring-inset)] hover:shadow-[var(--shadow-md),var(--ring-inset)]")}
                      >
                        <span className="text-2xl leading-none">{MARKETPLACES[m].flag}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{MARKETPLACES[m].domain.replace("www.", "")}</span>
                          <span className="block text-xs text-ink-3">{MARKETPLACES[m].currency}</span>
                        </span>
                        {on && (
                          <motion.span layoutId="mp-check" className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-accent text-white" transition={spring.snappy}>
                            <Check className="size-3" strokeWidth={3} />
                          </motion.span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                <Nav onBack={() => go("welcome")} onNext={() => go("products")} />
              </div>
            )}

            {step === "products" && (
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">{imports.length ? "Now add a competitor" : "Add your first product"}</h2>
                <p className="mt-2 text-md text-ink-2">{imports.length ? "Paste a rival listing you'd like to compare against." : "Paste an Amazon link — Aisle discovers its variants and lets you pick which to track."}</p>
                <div className="mt-8 space-y-2">
                  <AnimatePresence initial={false}>
                    {imports.map((r, i) => (
                      <motion.div key={i} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={spring.layout} className="card flex items-center gap-3 p-3.5">
                        <span className="flex size-8 items-center justify-center rounded-full bg-good-soft text-good">
                          <Check className="size-4" strokeWidth={2.6} />
                        </span>
                        <span className="text-sm font-medium">
                          {i === 0 ? "Your product" : `Competitor ${i}`} · {r.variantIds.length} variant{r.variantIds.length === 1 ? "" : "s"} tracked
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <motion.button
                    layout
                    whileTap={{ scale: 0.985 }}
                    onClick={() => importer.open(undefined, { onDone: (r) => setImports((x) => [...x, r]) })}
                    className="flex w-full items-center gap-3 rounded-[16px] border border-dashed border-[var(--line-strong)] bg-surface-2 p-5 text-left transition-colors hover:border-accent hover:bg-accent-softer"
                  >
                    <span className="flex size-10 items-center justify-center rounded-[12px] bg-accent text-white">
                      <Plus className="size-5" strokeWidth={2.4} />
                    </span>
                    <span>
                      <span className="block text-md font-semibold">{imports.length ? "Add a competitor" : "Paste an Amazon link"}</span>
                      <span className="block text-sm text-ink-3">{info.dataMode === "demo" ? "Demo mode: sample links are one click away." : "amazon.in/dp/…, amzn.to/…, or an ASIN"}</span>
                    </span>
                  </motion.button>
                </div>
                <Nav onBack={() => go("marketplace")} onNext={() => go("compare")} nextLabel={imports.length ? "Continue" : "I'll add products later"} />
              </div>
            )}

            {step === "compare" && (
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">{variantIds.length >= 2 ? "Name your first comparison" : "Almost there"}</h2>
                <p className="mt-2 text-md text-ink-2">{variantIds.length >= 2 ? `Group the ${variantIds.length} variants you added so Aisle can rank them on a unit-price basis.` : "Comparisons need at least two listings — you can create one any time from Products."}</p>
                <div className="mt-8 space-y-3">
                  {variantIds.length >= 2 && (
                    <div className="card p-4">
                      <label htmlFor="g-name" className="text-sm font-medium">Comparison name</label>
                      <Input id="g-name" autoFocus className="mt-2" placeholder="e.g. Plant Protein — India" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                    </div>
                  )}
                  <div className="card flex items-center gap-4 p-4">
                    <Layers className="size-5 text-accent" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Hourly monitoring</div>
                      <div className="text-xs text-ink-3">Checks run in the background — no need to keep Aisle open.</div>
                    </div>
                    <Switch checked={hourly} onCheckedChange={setHourly} label="Hourly monitoring" />
                  </div>
                </div>
                <div className="mt-10 flex items-center justify-between">
                  <Button variant="ghost" onClick={() => go("products")}>
                    <ArrowLeft className="size-4" /> Back
                  </Button>
                  <Button variant="primary" size="lg" loading={busy} disabled={variantIds.length >= 2 && !groupName.trim()} onClick={() => finish()}>
                    <Sparkles className="size-4" /> Open my dashboard
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel = "Continue" }: { onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="mt-10 flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="size-4" /> Back
      </Button>
      <Button variant="primary" size="lg" onClick={onNext}>
        {nextLabel} <ArrowRight className="size-4" />
      </Button>
    </div>
  );
}
