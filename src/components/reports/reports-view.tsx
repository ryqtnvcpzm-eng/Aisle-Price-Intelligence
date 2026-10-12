"use client";

import { motion } from "motion/react";
import { BarChart3, Boxes, FileSpreadsheet, FileText, History, LineChart, ListChecks, Repeat, Save, ShieldCheck, Tag, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { MARKETPLACES, isMarketplaceCode } from "@/lib/marketplaces";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";

const TYPES = [
  { value: "competitive_snapshot", label: "Competitive Pricing Snapshot", desc: "One comparison, ranked by unit price, with findings.", icon: BarChart3, needs: "group" },
  { value: "brand_comparison", label: "Brand Comparison", desc: "Premiums, leadership and availability by brand.", icon: Tag },
  { value: "variant_analysis", label: "Product Variant Analysis", desc: "Every variant of a product, normalized.", icon: Boxes, needs: "family" },
  { value: "price_history", label: "Historical Price Movement", desc: "Min, max, median, volatility, coverage.", icon: LineChart },
  { value: "change_log", label: "Price Change Log", desc: "Every observed change and stock event.", icon: ListChecks },
  { value: "portfolio_overview", label: "Portfolio Overview", desc: "All tracked listings with current state.", icon: FileSpreadsheet },
  { value: "monitoring_health", label: "Monitoring Health", desc: "Freshness, jobs and provider errors.", icon: ShieldCheck },
] as const;

interface Def { id: string; name: string; type: string; params: Record<string, unknown>; format: string; schedule: string; lastRunAt: string | null }
interface Run { id: string; type: string; format: string; rowCount: number; dataAsOf: string | null; containsSimulated: boolean; createdAt: string }

export function ReportsView({ groups, families, brands, marketplaces, definitions, runs }: { groups: { id: string; name: string }[]; families: { id: string; name: string }[]; brands: string[]; marketplaces: string[]; definitions: Def[]; runs: Run[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [type, setType] = useState<string>(params.get("type") ?? "competitive_snapshot");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const [brand, setBrand] = useState("all");
  const [marketplace, setMarketplace] = useState("all");
  const [days, setDays] = useState("30");
  const [format, setFormat] = useState<"pdf" | "xlsx" | "csv">("pdf");
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [schedule, setSchedule] = useState("none");
  const t = TYPES.find((x) => x.value === type)!;

  const body = () => ({
    type,
    format,
    groupId: "needs" in t && t.needs === "group" ? groupId : undefined,
    familyId: "needs" in t && t.needs === "family" ? familyId : undefined,
    brandNames: brand !== "all" ? [brand] : undefined,
    marketplace: marketplace !== "all" ? marketplace : undefined,
    from: new Date(Date.now() - Number(days) * 864e5).toISOString(),
    to: new Date().toISOString(),
  });

  async function generate(b = body()) {
    setBusy(true);
    try {
      const res = await fetch("/api/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new ApiError(j.error?.message ?? "Report failed", res.status);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `aisle-report.${b.format}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Report ready", { description: res.headers.get("X-Aisle-Simulated") === "1" ? "Contains simulated demo data — clearly marked inside." : "Includes methodology and freshness notes." });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Report failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      const { format: f, ...rest } = body();
      await api("/api/reports/definitions", { method: "POST", body: { name: saveName.trim() || t.label, schedule, params: { ...rest, format: f } } });
      toast.success(schedule === "none" ? "Report saved" : `Saved — it will run ${schedule}`);
      setSaveName("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          {TYPES.map((x, i) => {
            const on = x.value === type;
            return (
              <motion.li key={x.value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i, 0.03) }}>
                <button onClick={() => setType(x.value)} aria-pressed={on} className={cn("flex w-full items-start gap-3 rounded-[16px] bg-surface p-4 text-left transition-shadow", on ? "shadow-[0_0_0_2px_var(--accent),var(--shadow-md)]" : "shadow-[var(--shadow-sm),var(--ring-inset)] hover:shadow-[var(--shadow-md),var(--ring-inset)]")}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[10px]", on ? "bg-accent text-white" : "bg-accent-soft text-accent")}><x.icon className="size-4" /></span>
                  <span>
                    <span className="block text-sm font-semibold">{x.label}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">{x.desc}</span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>

        <section className="card p-5">
          <h2 className="text-md font-semibold tracking-tight">Recent runs</h2>
          <ul className="mt-3 divide-y divide-[var(--hairline)]">
            {runs.length === 0 && <li className="py-6 text-center text-sm text-ink-3">No reports generated yet.</li>}
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <History className="size-4 text-ink-3" />
                <span className="flex-1">{TYPES.find((x) => x.value === r.type)?.label ?? r.type}</span>
                <Badge size="xs" tone="outline">{r.format.toUpperCase()}</Badge>
                {r.containsSimulated && <Badge size="xs" tone="sim">Simulated</Badge>}
                <span className="num text-xs text-ink-3">{r.rowCount} rows</span>
                <span className="w-20 text-right text-xs text-ink-3">{relativeTime(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="card space-y-4 p-5 lg:sticky lg:top-20">
          <div>
            <div className="eyebrow">Configure</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{t.label}</h2>
          </div>
          {"needs" in t && t.needs === "group" && (
            <Field label="Comparison">
              {groups.length ? <Select ariaLabel="Comparison" className="w-full" value={groupId} onValueChange={setGroupId} options={groups.map((g) => ({ value: g.id, label: g.name }))} /> : <p className="text-sm text-ink-3">Create a comparison first.</p>}
            </Field>
          )}
          {"needs" in t && t.needs === "family" && (
            <Field label="Product">
              <Select ariaLabel="Product" className="w-full" value={familyId} onValueChange={setFamilyId} options={families.map((f) => ({ value: f.id, label: f.name }))} />
            </Field>
          )}
          {!("needs" in t) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Brand">
                <Select ariaLabel="Brand" className="w-full" value={brand} onValueChange={setBrand} options={[{ value: "all", label: "All brands" }, ...brands.map((b) => ({ value: b, label: b }))]} />
              </Field>
              <Field label="Marketplace">
                <Select ariaLabel="Marketplace" className="w-full" value={marketplace} onValueChange={setMarketplace} options={[{ value: "all", label: "All" }, ...marketplaces.map((m) => ({ value: m, label: isMarketplaceCode(m) ? `${MARKETPLACES[m].flag} ${MARKETPLACES[m].domain.replace("www.", "")}` : m }))]} />
              </Field>
            </div>
          )}
          <Field label="Period">
            <Segmented ariaLabel="Period" size="sm" value={days} onChange={setDays} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "365", label: "1 year" }]} />
          </Field>
          <Field label="Format">
            <Segmented ariaLabel="Format" size="sm" value={format} onChange={setFormat} options={[{ value: "pdf", label: <><FileText className="size-3" /> PDF</> }, { value: "xlsx", label: "Excel" }, { value: "csv", label: "CSV" }]} />
          </Field>
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => generate()} disabled={("needs" in t && t.needs === "group" && !groupId) || ("needs" in t && t.needs === "family" && !familyId)}>
            Generate report
          </Button>
          <div className="space-y-2 pt-3 hairline-t">
            <div className="text-xs font-medium text-ink-2">Save this configuration</div>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={t.label} className="h-8 text-sm" aria-label="Saved report name" />
            <div className="flex gap-2">
              <Select ariaLabel="Schedule" size="sm" className="flex-1" value={schedule} onValueChange={setSchedule} options={[{ value: "none", label: "On demand" }, { value: "daily", label: "Every day" }, { value: "weekly", label: "Every week" }]} />
              <Button size="sm" onClick={save}><Save className="size-3.5" /> Save</Button>
            </div>
          </div>
        </section>

        {definitions.length > 0 && (
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Saved reports</h2>
            <ul className="mt-2 space-y-1">
              {definitions.map((d) => (
                <li key={d.id} className="flex items-center gap-2 rounded-[10px] px-1 py-1.5 text-sm">
                  {d.schedule !== "none" ? <Repeat className="size-3.5 text-accent" /> : <FileText className="size-3.5 text-ink-3" />}
                  <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => generate({ ...(d.params as ReturnType<typeof body>), type: d.type, format: d.format as "pdf", from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() })}>
                    {d.name}
                  </button>
                  <span className="text-2xs text-ink-3">{d.schedule === "none" ? d.format.toUpperCase() : d.schedule}</span>
                  <button aria-label={`Delete ${d.name}`} className="text-ink-4 hover:text-bad" onClick={async () => { await api(`/api/reports/definitions?id=${d.id}`, { method: "DELETE" }); router.refresh(); }}>
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-ink-3">Scheduled reports are generated by the background worker each morning and announced by email when configured.</p>
          </section>
        )}
      </aside>
    </div>
  );
}
