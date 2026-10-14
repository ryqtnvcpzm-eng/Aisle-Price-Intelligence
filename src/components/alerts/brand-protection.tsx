"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import type { ProtectionStatus, ProtectionType } from "@/server/alerts/protection";
import { ChooseBrandDialog } from "../brand/choose-brand-dialog";
import { spring, staggerDelay } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Button, ButtonLink } from "../ui/button";
import { SimulatedBadge } from "../ui/status";

// Mirrors PROTECTION_COPY on the server (kept here so the client bundle never imports server code).
const COPY: Record<ProtectionType, { label: string; description: string }> = {
  competitor_undercut: { label: "Competitor undercut", description: "A competitor’s unit price drops below your best unit price." },
  price_leadership_change: { label: "Leadership change", description: "The brand with the lowest unit price changes." },
  reference_out_of_stock: { label: "You go out of stock", description: "One of your listings is reported out of stock after being available." },
  rival_drop_5pct: { label: "Rival drops 5%+", description: "A competitor’s observed price falls 5% or more between two checks." },
};

/** Turn the pack on or off; the one control used on Overview and Alerts. */
export function useProtectionToggle() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(enabled: boolean) {
    setBusy(true);
    try {
      const r = await api<{ enabled: boolean; groups?: number; activeRules?: number; unmatched?: number }>("/api/alerts/protection", { method: "POST", body: { enabled } });
      if (enabled) toast.success("Protect My Brand is on", { description: r.groups ? `Watching ${r.groups} comparison${r.groups === 1 ? "" : "s"} with ${r.activeRules} rules. Alerts are checked after every refresh.` : "No comparisons yet — rules start as soon as a competitor shares a category and unit with your brand." });
      else toast("Protect My Brand is off", { description: "Its rules are paused; their history is kept." });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, set };
}

/** Compact call to action for Overview: choose a brand → turn on → see status. */
export function ProtectMyBrandButton({ brand, enabled, size = "md" }: { brand: { id: string; name: string } | null; enabled: boolean; size?: "sm" | "md" }) {
  const [choosing, setChoosing] = useState(false);
  const toggle = useProtectionToggle();
  if (enabled)
    return (
      <ButtonLink href="/alerts#protect" size={size} variant="ghost">
        <ShieldCheck className="size-4 text-good" /> Protected
      </ButtonLink>
    );
  return (
    <>
      <Button size={size} variant="primary" loading={toggle.busy} onClick={() => (brand ? toggle.set(true) : setChoosing(true))}>
        <ShieldCheck className="size-4" /> Protect My Brand
      </Button>
      <ChooseBrandDialog key={String(choosing)} open={choosing} onOpenChange={setChoosing} current={null} />
    </>
  );
}

/** Alerts → Brand Protection section. */
export function BrandProtection({ status }: { status: ProtectionStatus }) {
  const toggle = useProtectionToggle();
  const [choosing, setChoosing] = useState(false);
  const { brand, enabled } = status;

  return (
    <section id="protect" className="card scroll-mt-24 p-5" aria-labelledby="protect-title">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[12px]", enabled ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>
          {enabled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="protect-title" className="text-lg font-semibold tracking-tight">Protect My Brand</h2>
            {enabled ? <Badge tone="good" size="xs">On</Badge> : <Badge size="xs">Off</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            {!brand
              ? "Four alerts that watch your brand against the market. Choose your brand to start."
              : enabled
                ? `Watching ${brand.name} in ${status.groups.length} comparison${status.groups.length === 1 ? "" : "s"}. Each alert fires at most once a day per listing.`
                : `Four alerts that watch ${brand.name} in its “vs Market” comparisons, checked after every refresh.`}
          </p>
        </div>
        {!brand ? (
          <Button variant="primary" onClick={() => setChoosing(true)}>Choose your brand</Button>
        ) : enabled ? (
          <Button variant="ghost" size="sm" loading={toggle.busy} onClick={() => toggle.set(false)}>Turn off</Button>
        ) : (
          <Button variant="primary" loading={toggle.busy} onClick={() => toggle.set(true)}>
            <ShieldCheck className="size-4" /> Protect My Brand
          </Button>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {status.rules.map((r, i) => (
          <motion.li key={r.type} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i) }} className="rounded-[12px] bg-surface-2 p-3.5 shadow-[var(--ring-inset)]">
            <div className="flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", enabled && r.active ? "bg-good" : "bg-ink-4")} aria-hidden />
              <span className="text-sm font-semibold tracking-tight">{COPY[r.type].label}</span>
            </div>
            <p className="mt-1 text-xs text-ink-3">{COPY[r.type].description}</p>
            {enabled && (
              <p className="num mt-2 text-2xs text-ink-3">
                {r.fired} fired{r.lastTriggeredAt ? ` · last ${relativeTime(r.lastTriggeredAt)}` : ""}
                {r.paused > 0 && ` · ${r.paused} paused`}
              </p>
            )}
          </motion.li>
        ))}
      </ul>

      <AnimatePresence initial={false}>
        {enabled && status.groups.length === 0 && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-3 text-xs text-ink-3">
            No comparisons yet. Rules start as soon as a competitor shares a category and unit with {brand?.name}. <Link href="/brands" className="font-medium text-accent">See what’s not yet matched</Link>
          </motion.p>
        )}
      </AnimatePresence>

      {enabled && status.events.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Recent</h3>
          <ul className="mt-1.5 divide-y divide-[var(--hairline)]">
            {status.events.slice(0, 5).map((e) => (
              <li key={e.id}>
                <Link href={`/alerts?event=${e.id}`} className="-mx-2 flex items-start gap-3 rounded-[9px] px-2 py-2.5 hover:bg-[var(--hairline)]">
                  <span className="num w-[78px] shrink-0 pt-0.5 text-xs text-ink-3">{relativeTime(e.firedAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{e.headline}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
                      {COPY[e.type].label}
                      {e.groupName && <> · {e.groupName}</>}
                      {e.isSimulated && <SimulatedBadge compact />}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ChooseBrandDialog key={String(choosing)} open={choosing} onOpenChange={setChoosing} current={null} />
    </section>
  );
}
