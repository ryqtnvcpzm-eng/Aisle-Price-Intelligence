"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Activity, Bell, Check, Database, Download, Globe2, KeyRound, Monitor, Moon, Palette, RefreshCw, Sun, User, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks/use-now";
import { relativeTime, workerAlive } from "@/lib/freshness";
import { MARKETPLACES, PRIMARY_MARKETPLACES } from "@/lib/marketplaces";
import { NORMALIZATION_BASES } from "@/lib/quantity";
import type { ProviderInfo } from "@/server/providers";
import type { BudgetSummary } from "@/server/monitoring/budget";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { usePrefs, type ThemePref } from "../shell/preferences";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "workspace", label: "Workspace", icon: Users },
  { id: "marketplaces", label: "Marketplaces & units", icon: Globe2 },
  { id: "monitoring", label: "Monitoring", icon: RefreshCw },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "providers", label: "Data providers", icon: KeyRound },
  { id: "usage", label: "API usage", icon: Activity },
  { id: "retention", label: "Data retention", icon: Database },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "exports", label: "Export preferences", icon: Download },
];

interface Props {
  user: { name: string; email: string };
  role: string;
  workspace: { name: string; defaultMarketplace: string; defaultCurrency: string | null; defaultBasis: string; timeZone: string; settings: { defaultIntervalMinutes: number; digest: string; emailAlerts: boolean; exportIncludeMethodology: boolean; significantChangePct: number; marketplaceIntervals?: Record<string, number> } };
  providers: ProviderInfo[];
  mode: "demo" | "live";
  active: string;
  budget: BudgetSummary;
  jobs: { id: string; kind: string; status: string; provider: string; marketplace: string; listings: number; observations: number; tokens: number; createdAt: string; error: string | null }[];
  integrations: { email: boolean; ai: boolean; retentionDays: number; shortLinks: boolean };
}

export function SettingsView({ user, role, workspace, providers, mode, active, budget, jobs, integrations }: Props) {
  const router = useRouter();
  const { theme, setTheme, reducedTransparency, setReducedTransparency, sidebarCollapsed, setSidebarCollapsed } = usePrefs();
  const [name, setName] = useState(workspace.name);
  const [tz, setTz] = useState(workspace.timeZone);
  const canEdit = role === "owner" || role === "admin";

  async function save(body: Record<string, unknown>, msg = "Saved") {
    try {
      await api("/api/workspace", { method: "PATCH", body });
      toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save.");
    }
  }
  const setSetting = (k: string, v: unknown) => save({ settings: { [k]: v } });

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_1fr]">
      <nav className="hidden lg:block" aria-label="Settings sections">
        <ul className="sticky top-20 space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-sm text-ink-2 hover:bg-[var(--hairline)] hover:text-ink">
                <s.icon className="size-4 text-ink-3" /> {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-6">
        <Section id="profile" title="Profile">
          <Row label="Name" value={user.name} />
          <Row label="Email" value={user.email} />
          <Row label="Role" value={<Badge size="xs">{role}</Badge>} />
        </Section>

        <Section id="workspace" title="Workspace" description={canEdit ? undefined : "Only owners and admins can change workspace settings."}>
          <Row label="Name" control={<div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-60 text-sm" disabled={!canEdit} aria-label="Workspace name" /><Button size="sm" disabled={!canEdit || name === workspace.name} onClick={() => save({ name })}>Save</Button></div>} />
          <Row label="Time zone" hint="Used for quiet hours, digests and dashboard greetings." control={<div className="flex gap-2"><Input value={tz} onChange={(e) => setTz(e.target.value)} className="h-8 w-60 text-sm" disabled={!canEdit} aria-label="Time zone" /><Button size="sm" disabled={!canEdit || tz === workspace.timeZone} onClick={() => save({ timeZone: tz })}>Save</Button></div>} />
        </Section>

        <Section id="marketplaces" title="Marketplaces & units">
          <Row label="Default marketplace" hint="Used for bare ASINs. Links are always detected from their domain." control={<Select ariaLabel="Default marketplace" size="sm" value={workspace.defaultMarketplace} onValueChange={(v) => save({ defaultMarketplace: v })} options={PRIMARY_MARKETPLACES.map((m) => ({ value: m, label: `${MARKETPLACES[m].flag} ${MARKETPLACES[m].name}` }))} />} />
          <Row label="Currency" hint="Prices are never converted or mixed across currencies; cross-marketplace views compare percentage changes instead." value="Each marketplace’s own currency" />
          <Row label="Default unit basis" hint="Starting basis for new comparisons." control={<Select ariaLabel="Default basis" size="sm" value={workspace.defaultBasis} onValueChange={(v) => save({ defaultBasis: v })} options={Object.entries(NORMALIZATION_BASES).map(([k, v]) => ({ value: k, label: v.long }))} />} />
        </Section>

        <Section id="monitoring" title="Monitoring" description="Checks run in the background worker. A successful check means the provider answered — not that Amazon changed its price that hour.">
          <Row label="Default frequency" control={<Select ariaLabel="Default frequency" size="sm" value={String(workspace.settings.defaultIntervalMinutes)} onValueChange={(v) => setSetting("defaultIntervalMinutes", Number(v))} options={[{ value: "60", label: "Hourly" }, { value: "180", label: "Every 3 hours" }, { value: "360", label: "Every 6 hours" }, { value: "720", label: "Every 12 hours" }, { value: "1440", label: "Daily" }]} />} />
          <Row label="Significant change" hint="Threshold for competitor-move insights." control={<Segmented ariaLabel="Significant change" size="sm" value={String(workspace.settings.significantChangePct)} onChange={(v) => setSetting("significantChangePct", Number(v))} options={["2", "3", "5", "10"].map((v) => ({ value: v, label: `${v}%` }))} />} />
          <Row label="Short links" hint="amzn.to / a.co links are resolved server-side with an Amazon-only allowlist." value={integrations.shortLinks ? "Enabled" : "Disabled"} />
          <Row label="Status" value={<WorkerStatus />} />
        </Section>

        <Section id="notifications" title="Notifications">
          <Row label="Digest" hint="A summary of real (non-simulated) alert events." control={<Segmented ariaLabel="Digest" size="sm" value={workspace.settings.digest} onChange={(v) => setSetting("digest", v)} options={[{ value: "off", label: "Off" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} />} />
          <Row label="Email delivery" hint={integrations.email ? "Transactional email is configured." : "Set RESEND_API_KEY to enable email. In-app notifications always work."} control={<Switch checked={workspace.settings.emailAlerts && integrations.email} onCheckedChange={(v) => setSetting("emailAlerts", v)} disabled={!integrations.email} label="Email alerts" />} />
        </Section>

        <Section id="providers" title="Data providers">
          <div className={cn("mx-5 mb-2 rounded-[12px] px-4 py-3 text-sm", mode === "demo" ? "bg-sim-soft" : "bg-good-soft")}>
            {mode === "demo" ? (
              <><span className="font-semibold text-sim">Demo mode.</span> <span className="text-ink-2">No provider credentials are configured, so Aisle uses its fictional catalog with simulated prices. Every simulated value is labelled. Add Amazon Creators API credentials (free with an Associates account) to switch to live data.</span></>
            ) : (
              <><span className="font-semibold text-good">Live data.</span> <span className="text-ink-2">New imports use {providers.find((p) => p.active)?.label}. Existing simulated listings stay labelled.</span></>
            )}
          </div>
          <ul className="divide-y divide-[var(--hairline)]">
            {providers.map((p) => <ProviderRow key={p.id} p={p} />)}
          </ul>
        </Section>

        <Section id="usage" title="API usage" description={`Provider: ${active}. Aisle uses only free data sources. Safeguards pause polling when a provider asks it to slow down.`}>
          <div className="grid grid-cols-2 gap-px overflow-hidden bg-[var(--hairline)] sm:grid-cols-4">
            {[
              ["Monitored listings", budget.monitoredListings],
              ["Requests / day (est.)", budget.requestsPerDay],
              ["Requests this month", budget.requestsMonth],
              ["Items checked this month", budget.tokensUsedMonth],
              ["Allowance left", budget.tokensLeft ?? "—"],
              ["Cost", "Free"],
              ["Failures (24h)", `${budget.failures24h} / ${budget.requests24h}`],
            ].map(([k, v]) => (
              <div key={k as string} className="bg-surface px-4 py-3">
                <div className="text-2xs text-ink-3">{k}</div>
                <div className="num mt-0.5 text-md font-semibold">{typeof v === "number" ? v.toLocaleString() : v}</div>
              </div>
            ))}
          </div>
          {budget.pausedUntil && new Date(budget.pausedUntil) > new Date() && <p className="mx-5 mt-3 rounded-[10px] bg-warn-soft px-3 py-2 text-xs">Polling paused until {new Date(budget.pausedUntil).toLocaleTimeString()} — the provider asked us to wait.</p>}
          <div className="overflow-x-auto px-5 pb-2 pt-4">
            <div className="eyebrow mb-2">Recent jobs</div>
            <table className="w-full min-w-[560px] text-xs">
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="hairline-t">
                    <td className="py-2 text-ink-3">{relativeTime(j.createdAt)}</td>
                    <td className="py-2">{j.kind}</td>
                    <td className="py-2">{j.provider} · {j.marketplace}</td>
                    <td className="num py-2 text-right">{j.listings} listings</td>
                    <td className="num py-2 text-right">{j.observations} obs.</td>
                    <td className="py-2 pl-3 text-right"><Badge size="xs" tone={j.status === "succeeded" ? "good" : j.status === "failed" ? "bad" : j.status === "partial" ? "warn" : "neutral"}>{j.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="retention" title="Data retention" description="Set to whatever your provider licence allows. Older observations are deleted nightly by the worker.">
          <Row label="Observation history" value={`${integrations.retentionDays} days (OBSERVATION_RETENTION_DAYS)`} />
          <Row label="Request logs" value="90 days" />
          <Row label="Activity" value="365 days" />
        </Section>

        <Section id="appearance" title="Appearance">
          <Row label="Theme" control={<Segmented<ThemePref> ariaLabel="Theme" size="sm" value={theme} onChange={setTheme} options={[{ value: "light", label: <><Sun className="size-3" /> Light</> }, { value: "system", label: <><Monitor className="size-3" /> Auto</> }, { value: "dark", label: <><Moon className="size-3" /> Dark</> }]} />} />
          <Row label="Reduce transparency" hint="Replaces translucent materials with solid surfaces." control={<Switch checked={reducedTransparency} onCheckedChange={setReducedTransparency} label="Reduce transparency" />} />
          <Row label="Compact sidebar" control={<Switch checked={sidebarCollapsed} onCheckedChange={setSidebarCollapsed} label="Compact sidebar" />} />
          <Row label="Motion" value="Follows your system's Reduce Motion setting" />
        </Section>

        <Section id="exports" title="Export preferences">
          <Row label="AI briefings" hint="Optional. Off unless you add an Anthropic API key — API usage is separate from Claude chat plans." value={integrations.ai ? "Enabled" : "Off"} />
          <Row label="Methodology notes" hint="Every report includes how numbers were computed and data freshness." control={<Switch checked={workspace.settings.exportIncludeMethodology} onCheckedChange={(v) => setSetting("exportIncludeMethodology", v)} label="Include methodology" />} />
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <motion.section id={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card scroll-mt-20 overflow-hidden">
      <header className="px-5 pb-2 pt-4">
        <h2 className="text-md font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </header>
      <div className="pb-2">{children}</div>
    </motion.section>
  );
}

function Row({ label, hint, value, control }: { label: string; hint?: string; value?: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-5 py-3 hairline-t sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="mt-0.5 max-w-[420px] text-xs text-ink-3">{hint}</div>}
      </div>
      {control ?? <div className="text-sm text-ink-2">{value}</div>}
    </div>
  );
}

function ProviderRow({ p }: { p: ProviderInfo }) {
  const [diag, setDiag] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const caps = p.capabilities;
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{p.label}</span>
        {p.active && <Badge tone="accent" size="xs">Active for imports</Badge>}
        {p.configured ? <Badge tone="good" size="xs">Configured</Badge> : <Badge size="xs">Not configured</Badge>}
        {p.simulated && <Badge tone="sim" size="xs">Simulated</Badge>}
        {p.active && (
          <Button
            size="xs"
            className="ml-auto"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await api<{ diagnosis: { ok: boolean; message: string } }>("/api/providers/status?diagnose=1").catch(() => null);
              setDiag(r?.diagnosis ?? { ok: false, message: "Diagnostics failed." });
              setBusy(false);
            }}
          >
            Test connection
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-3">{p.note}</p>
      {diag && <p className={cn("mt-2 rounded-[8px] px-3 py-2 text-xs", diag.ok ? "bg-good-soft" : "bg-bad-soft")}>{diag.message}</p>}
      {caps && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {([["productDetails", "Details"], ["variations", "Variations"], ["currentOffers", "Offers"], ["priceHistory", "History"], ["search", "Search"], ["providerFreshness", "Freshness"], ["quota", "Quota"], ["monitoring", "Scheduled monitoring"]] as const).map(([k, l]) => (
            <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs", caps[k] ? "bg-good-soft text-good" : "bg-[var(--hairline)] text-ink-4")}>
              {caps[k] ? <Check className="size-2.5" /> : <X className="size-2.5" />} {l}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function WorkerStatus() {
  const { data } = useQuery({ queryKey: ["status"], queryFn: () => api<{ worker: { at: string; mode?: "queue" | "scheduled" } | null }>("/api/providers/status"), refetchInterval: 30_000 });
  const now = useNow();
  const alive = workerAlive(data?.worker, now);
  return <span className={cn("inline-flex items-center gap-1.5 text-sm", alive ? "text-good" : "text-warn")}><span className={cn("size-2 rounded-full", alive ? "bg-good" : "bg-warn")} />{alive ? `${data?.worker?.mode === "scheduled" ? "Scheduled runner" : "Worker running"} · last heartbeat ${relativeTime(data!.worker!.at)}` : "Worker not detected"}</span>;
}
