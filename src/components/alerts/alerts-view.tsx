"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bell, BellRing, Moon, MoreHorizontal, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { formatMoney, majorToMinor, minorToMajor } from "@/lib/money";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { Field, Input } from "../ui/input";
import { Menu, MenuItem, MenuSeparator } from "../ui/popover";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { SimulatedBadge } from "../ui/status";
import { Switch } from "../ui/switch";
import { Tabs } from "../ui/tabs";
import type { ProtectionStatus } from "@/server/alerts/protection";
import { BrandProtection } from "./brand-protection";

interface Rule {
  id: string;
  name: string;
  type: string;
  variant_id: string | null;
  group_id: string | null;
  params: Record<string, number>;
  frequency: string;
  channels: string[];
  cooldown_minutes: number;
  quiet_hours: { start: string; end: string } | null;
  paused: boolean;
  last_triggered_at: string | null;
  group_name: string | null;
  family_title: string | null;
  variant_label: string | null;
  event_count: number;
  managed_key: string | null;
}
interface Event {
  id: string;
  ruleId: string;
  headline: string;
  detail: string | null;
  firedAt: string;
  isSimulated: boolean;
  isTest: boolean;
  deliveredChannels: string[];
}

const TYPES: { value: string; label: string; family: string; needs?: "threshold" | "pct" | "gap" | "hours" | "failures"; scope: "item" | "group" | "any" | "workspace" }[] = [
  { value: "pct_drop", label: "Price falls by a percentage", family: "Price", needs: "pct", scope: "item" },
  { value: "pct_rise", label: "Price rises by a percentage", family: "Price", needs: "pct", scope: "item" },
  { value: "price_below", label: "Price drops below", family: "Price", needs: "threshold", scope: "item" },
  { value: "price_above", label: "Price rises above", family: "Price", needs: "threshold", scope: "item" },
  { value: "daily_move", label: "Moves sharply within 24 hours", family: "Price", needs: "pct", scope: "item" },
  { value: "historical_low", label: "Reaches an observed low", family: "Price", scope: "item" },
  { value: "competitor_undercut", label: "A competitor undercuts the reference", family: "Competitive", scope: "group" },
  { value: "gap_exceeds", label: "Gap to competitor median exceeds", family: "Competitive", needs: "gap", scope: "group" },
  { value: "leader_change", label: "Price leadership changes", family: "Competitive", scope: "group" },
  { value: "out_of_stock", label: "Becomes unavailable", family: "Availability", scope: "item" },
  { value: "back_in_stock", label: "Comes back in stock", family: "Availability", scope: "item" },
  { value: "stale_data", label: "Hasn't refreshed in a while", family: "Data quality", needs: "hours", scope: "any" },
  { value: "monitoring_failures", label: "Repeated monitoring failures", family: "Data quality", needs: "failures", scope: "any" },
  { value: "quota_exhausted", label: "Provider allowance exhausted", family: "Data quality", scope: "workspace" },
  { value: "price_leadership_change", label: "The lowest-price brand changes", family: "Competitive", scope: "group" },
  { value: "reference_out_of_stock", label: "Your listing goes out of stock", family: "Competitive", scope: "group" },
  { value: "rival_drop_5pct", label: "A rival drops its price by 5%+", family: "Competitive", scope: "group" },
];

export function AlertsView({ protection, rules, events, variants, groups, emailConfigured }: { protection: ProtectionStatus; rules: Rule[]; events: Event[]; variants: { id: string; name: string; currency: string; price: number | null }[]; groups: { id: string; name: string }[]; emailConfigured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<"rules" | "history">(params.get("event") ? "history" : "rules");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [prefill, setPrefill] = useState<{ variantId?: string; groupId?: string }>({});
  const highlight = params.get("event");

  useEffect(() => {
    if (params.get("new") === "1") {
      // One-shot deep link (?new=1) from elsewhere in the app: open the editor, then clean the URL.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefill({ variantId: params.get("variant") || undefined, groupId: params.get("group") || undefined });
      setEditing("new");
      router.replace("/alerts");
    }
  }, [params, router]);

  async function toggle(r: Rule) {
    await api(`/api/alerts/rules/${r.id}`, { method: "PATCH", body: { paused: !r.paused } });
    router.refresh();
  }
  async function remove(r: Rule) {
    await api(`/api/alerts/rules/${r.id}`, { method: "DELETE" });
    toast(`Deleted “${r.name}”`);
    router.refresh();
  }
  async function test(r: Rule) {
    try {
      const res = await api<{ channels: string[]; email: { status: string; reason: string | null } | null }>(`/api/alerts/rules/${r.id}/test`, { method: "POST" });
      const emailNote = res.email ? (res.email.status === "sent" ? " Email sent to you." : res.email.status === "pending" ? " Email queued for retry." : ` Email not sent: ${res.email.reason ?? "unknown reason"}`) : "";
      toast.success("Test notification sent", { description: `Delivered in-app.${emailNote}` });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Test failed.");
    }
  }

  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules]);
  // Protect My Brand rules are managed as a pack in the section above, not one by one.
  const ownRules = rules.filter((r) => !r.managed_key);
  const managedCount = rules.length - ownRules.length;

  return (
    <div className="space-y-5">
      <BrandProtection status={protection} />
      <div className="flex items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "rules", label: "Rules", count: ownRules.length }, { value: "history", label: "History", count: events.length }]} className="flex-1" />
        <Button variant="primary" onClick={() => { setPrefill({}); setEditing("new"); }}>
          <Plus className="size-4" /> New alert
        </Button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {tab === "rules" ? (
          <motion.div key="rules" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {!ownRules.length ? (
              <EmptyState icon={<Bell />} title="No alerts yet" description="Get told when a competitor undercuts you, a price hits a threshold, or a listing goes out of stock." action={<Button variant="primary" onClick={() => setEditing("new")}>Create your first alert</Button>} />
            ) : (
              <ul className="card divide-y divide-[var(--hairline)]">
                {ownRules.map((r, i) => {
                  const t = TYPES.find((x) => x.value === r.type);
                  return (
                    <motion.li key={r.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }} className="flex items-center gap-4 px-5 py-4">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px]", r.paused ? "bg-[var(--hairline)] text-ink-4" : "bg-accent-soft text-accent")}>
                        <BellRing className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-md font-semibold tracking-tight">{r.name}</span>
                          <Badge size="xs">{t?.family}</Badge>
                          {r.frequency !== "instant" && <Badge size="xs" tone="outline">{r.frequency} digest</Badge>}
                          {r.quiet_hours && <Badge size="xs" tone="outline"><Moon className="size-2.5" /> {r.quiet_hours.start}–{r.quiet_hours.end}</Badge>}
                          {r.channels.includes("email") && <Badge size="xs" tone="outline">Email</Badge>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-3">
                          {t?.label}
                          {describeParams(r, variants)} · {r.group_name ? `Group: ${r.group_name}` : r.variant_label ? `${r.family_title?.split(",")[0]} · ${r.variant_label}` : "Whole workspace"} · cooldown {Math.round(r.cooldown_minutes / 60)}h
                        </div>
                      </div>
                      <div className="hidden text-right text-xs text-ink-3 sm:block">
                        <div className="num">{r.event_count} fired</div>
                        <div>{r.last_triggered_at ? `last ${relativeTime(r.last_triggered_at)}` : "never"}</div>
                      </div>
                      <Switch checked={!r.paused} onCheckedChange={() => toggle(r)} label={`${r.paused ? "Resume" : "Pause"} ${r.name}`} />
                      <Menu align="end" trigger={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}><MoreHorizontal className="size-4" /></Button>}>
                        <MenuItem icon={<Pencil />} onSelect={() => setEditing(r)}>Edit…</MenuItem>
                        <MenuItem icon={<Send />} onSelect={() => test(r)}>Send test notification</MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} destructive onSelect={() => remove(r)}>Delete</MenuItem>
                      </Menu>
                    </motion.li>
                  );
                })}
              </ul>
            )}
            {managedCount > 0 && <p className="mt-3 text-xs text-ink-3">Plus {managedCount} Protect My Brand rule{managedCount === 1 ? "" : "s"}, managed as one pack above.</p>}
            <p className="mt-3 text-xs text-ink-3">Alerts from simulated demo data appear in-app only — they’re never emailed. Use “Send test notification” to try delivery.{emailConfigured ? "" : " Email isn't set up yet (Settings → Notifications), so alerts are in-app."}</p>
          </motion.div>
        ) : (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {!events.length ? (
              <EmptyState compact icon={<Bell />} title="No alerts have fired" description="When a rule's condition is met, the event is recorded here with the exact numbers." />
            ) : (
              <ul className="card divide-y divide-[var(--hairline)]">
                {events.map((e) => (
                  <li key={e.id} className={cn("flex items-start gap-4 px-5 py-3.5", highlight === e.id && "bg-accent-softer")}>
                    <span className="num w-[86px] shrink-0 pt-0.5 text-xs text-ink-3">{new Date(e.firedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{e.headline}</div>
                      <div className="text-xs text-ink-2">{e.detail}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
                        <span>{ruleName.get(e.ruleId) ?? "Deleted rule"}</span>
                        <span>· via {e.deliveredChannels.join(", ").replace("in_app", "in-app") || "—"}</span>
                        {e.isSimulated && <SimulatedBadge compact />}
                        {e.isTest && <Badge size="xs">Test</Badge>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <RuleDialog key={editing === "new" ? `new-${prefill.variantId}-${prefill.groupId}` : (editing?.id ?? "none")} open={editing !== null} onOpenChange={(v) => !v && setEditing(null)} rule={editing === "new" ? null : editing} prefill={prefill} variants={variants} groups={groups} emailConfigured={emailConfigured} />
    </div>
  );
}

function describeParams(r: Rule, variants: { id: string; currency: string }[]) {
  const cur = variants.find((v) => v.id === r.variant_id)?.currency ?? "INR";
  if (r.params.thresholdMinor) return ` ${formatMoney(r.params.thresholdMinor, cur)}`;
  if (r.params.pct) return ` ${r.params.pct}%`;
  if (r.params.gapPct) return ` ${r.params.gapPct}%`;
  if (r.params.hours) return ` ${r.params.hours}h`;
  if (r.params.failures) return ` ×${r.params.failures}`;
  return "";
}

function RuleDialog({ open, onOpenChange, rule, prefill, variants, groups, emailConfigured }: { open: boolean; onOpenChange: (v: boolean) => void; rule: Rule | null; prefill: { variantId?: string; groupId?: string }; variants: { id: string; name: string; currency: string; price: number | null }[]; groups: { id: string; name: string }[]; emailConfigured: boolean }) {
  const router = useRouter();
  const [type, setType] = useState(rule?.type ?? (prefill.groupId ? "competitor_undercut" : "pct_drop"));
  const t = TYPES.find((x) => x.value === type)!;
  const [scope, setScope] = useState<"variant" | "group" | "workspace">(rule?.group_id || prefill.groupId ? "group" : rule?.variant_id || prefill.variantId ? "variant" : t.scope === "group" ? "group" : "variant");
  const [variantId, setVariantId] = useState(rule?.variant_id ?? prefill.variantId ?? variants[0]?.id ?? "");
  const [groupId, setGroupId] = useState(rule?.group_id ?? prefill.groupId ?? groups[0]?.id ?? "");
  const cur = variants.find((v) => v.id === variantId)?.currency ?? "INR";
  const [value, setValue] = useState(() => {
    const p = rule?.params ?? {};
    if (p.thresholdMinor) return String(minorToMajor(p.thresholdMinor, cur));
    return String(p.pct ?? p.gapPct ?? p.hours ?? p.failures ?? (t.needs === "hours" ? 6 : t.needs === "failures" ? 3 : t.needs === "gap" ? 15 : 5));
  });
  const [name, setName] = useState(rule?.name ?? "");
  const [frequency, setFrequency] = useState(rule?.frequency ?? "instant");
  const [email, setEmail] = useState(rule?.channels.includes("email") ?? false);
  const [cooldown, setCooldown] = useState(String(rule?.cooldown_minutes ?? 360));
  const [quiet, setQuiet] = useState(Boolean(rule?.quiet_hours));
  const [quietStart, setQuietStart] = useState(rule?.quiet_hours?.start ?? "22:00");
  const [quietEnd, setQuietEnd] = useState(rule?.quiet_hours?.end ?? "07:00");
  const [busy, setBusy] = useState(false);

  const allowedScopes = t.scope === "group" ? ["group"] : t.scope === "workspace" ? ["workspace"] : t.scope === "any" ? ["variant", "group", "workspace"] : ["variant", "group"];
  const effScope = allowedScopes.includes(scope) ? scope : (allowedScopes[0] as typeof scope);

  async function save() {
    setBusy(true);
    const num = Number(value);
    const params: Record<string, number> = {};
    if (t.needs === "threshold") params.thresholdMinor = majorToMinor(num, cur);
    if (t.needs === "pct") params.pct = num;
    if (t.needs === "gap") params.gapPct = num;
    if (t.needs === "hours") params.hours = Math.round(num);
    if (t.needs === "failures") params.failures = Math.round(num);
    const body = {
      name: name.trim() || t.label,
      type,
      variantId: effScope === "variant" ? variantId : null,
      groupId: effScope === "group" ? groupId : null,
      params,
      frequency,
      channels: email ? ["in_app", "email"] : ["in_app"],
      cooldownMinutes: Number(cooldown),
      quietHours: quiet ? { start: quietStart, end: quietEnd } : null,
    };
    try {
      if (rule) await api(`/api/alerts/rules/${rule.id}`, { method: "PATCH", body });
      else await api("/api/alerts/rules", { method: "POST", body });
      toast.success(rule ? "Alert updated" : "Alert created", { description: "It's evaluated after every refresh." });
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save the alert.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={rule ? "Edit alert" : "New alert"} description="Alerts fire on transitions, not on every check — so you hear about changes once." size="md">
      <div className="space-y-4 overflow-y-auto px-6 py-5">
        <Field label="When">
          <Select ariaLabel="Alert type" className="w-full" value={type} onValueChange={setType} options={TYPES.map((x) => ({ value: x.value, label: x.label, hint: x.family }))} />
        </Field>
        {t.needs && (
          <Field label={t.needs === "threshold" ? `Price (${cur})` : t.needs === "hours" ? "Hours without a successful refresh" : t.needs === "failures" ? "Consecutive failures" : "Percentage"}>
            <div className="flex items-center gap-2">
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="w-32" aria-label="Threshold" />
              <span className="text-sm text-ink-3">{t.needs === "pct" || t.needs === "gap" ? "%" : t.needs === "hours" ? "hours" : ""}</span>
              {t.needs === "threshold" && variants.find((v) => v.id === variantId)?.price != null && <span className="text-xs text-ink-3">Now {formatMoney(variants.find((v) => v.id === variantId)!.price!, cur)}</span>}
            </div>
          </Field>
        )}
        <Field label="Watch">
          <div className="space-y-2">
            {allowedScopes.length > 1 && <Segmented ariaLabel="Scope" size="sm" value={effScope} onChange={(v) => setScope(v)} options={allowedScopes.map((s) => ({ value: s as typeof scope, label: s === "variant" ? "A product" : s === "group" ? "A comparison" : "Everything" }))} />}
            {effScope === "variant" && <Select ariaLabel="Product" className="w-full" value={variantId} onValueChange={setVariantId} options={variants.map((v) => ({ value: v.id, label: v.name }))} />}
            {effScope === "group" && <Select ariaLabel="Comparison" className="w-full" value={groupId} onValueChange={setGroupId} options={groups.map((g) => ({ value: g.id, label: g.name }))} />}
          </div>
        </Field>
        <Field label="Name" hint="Optional — defaults to the condition.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.label} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Delivery">
            <Select ariaLabel="Frequency" className="w-full" value={frequency} onValueChange={setFrequency} options={[{ value: "instant", label: "As it happens" }, { value: "daily", label: "Daily digest" }, { value: "weekly", label: "Weekly digest" }]} />
          </Field>
          <Field label="Cooldown" hint="Minimum gap between repeats per listing.">
            <Select ariaLabel="Cooldown" className="w-full" value={cooldown} onValueChange={setCooldown} options={[{ value: "60", label: "1 hour" }, { value: "360", label: "6 hours" }, { value: "720", label: "12 hours" }, { value: "1440", label: "1 day" }, { value: "10080", label: "1 week" }]} />
          </Field>
        </div>
        <div className="space-y-3 rounded-[12px] bg-surface-2 p-3.5 shadow-[var(--ring-inset)]">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Also email me
              {!emailConfigured && <span className="block text-2xs text-ink-3">Email isn&apos;t set up — in-app only for now. See Settings → Notifications.</span>}
            </span>
            <Switch checked={email} onCheckedChange={setEmail} label="Email notifications" disabled={!emailConfigured} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Quiet hours</span>
            <Switch checked={quiet} onCheckedChange={setQuiet} label="Quiet hours" />
          </label>
          <AnimatePresence initial={false}>
            {quiet && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.layout} className="flex items-center gap-2 overflow-hidden text-sm">
                <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} aria-label="Quiet hours start" className="h-8 rounded-[8px] bg-surface px-2 shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
                <span className="text-ink-3">to</span>
                <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} aria-label="Quiet hours end" className="h-8 rounded-[8px] bg-surface px-2 shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
                <span className="text-xs text-ink-3">Events still record; emails wait.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 hairline-t">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save} disabled={(t.needs && !Number(value)) || (effScope === "variant" && !variantId) || (effScope === "group" && !groupId)}>{rule ? "Save changes" : "Create alert"}</Button>
      </div>
    </Dialog>
  );
}
