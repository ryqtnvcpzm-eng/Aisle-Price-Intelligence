"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Archive, ArrowLeft, BarChart3, Bell, CheckCircle2, ChevronDown, Eye, EyeOff, ExternalLink, Info, MoreHorizontal, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, ViewTransition } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/freshness";
import { isMarketplaceCode, listingUrl, MARKETPLACES } from "@/lib/marketplaces";
import { formatMoney, pctChange } from "@/lib/money";
import { NORMALIZATION_BASES, unitPriceMinor, type NormalizationBasis } from "@/lib/quantity";
import type { VariantRow } from "@/server/catalog/queries";
import { PriceHistory } from "../charts/price-history";
import { useCompareTray } from "../comparisons/compare-tray";
import { spring, staggerDelay } from "../motion/tokens";
import { AnimatedNumber } from "../ui/animated-number";
import { Badge } from "../ui/badge";
import { Button, ButtonLink } from "../ui/button";
import { Menu, MenuItem, MenuSeparator } from "../ui/popover";
import { Delta, Price } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Freshness, MarketplaceTag, SimulatedBadge, StockBadge } from "../ui/status";
import { Switch } from "../ui/switch";
import { Tabs } from "../ui/tabs";
import { Tooltip } from "../ui/tooltip";
import { unitOf } from "./library-utils";
import { QuantityEditor } from "./quantity-editor";
import { useRefresh } from "./use-refresh";

export interface LatestObservation {
  observedAt: string;
  capturedAt: string;
  requestedAt: string | null;
  providerUpdatedAt: string | null;
  provider: string;
  currency: string;
  priceMinor: number | null;
  priceBasis: string;
  amazonPriceMinor: number | null;
  lowestNewPriceMinor: number | null;
  listPriceMinor: number | null;
  dealPriceMinor: number | null;
  primeExclusivePriceMinor: number | null;
  shippingMinor: number | null;
  availability: string;
  sellerIsAmazon: boolean | null;
  sellerName: string | null;
  isSimulated: boolean;
}

interface FamilyInfo {
  id: string;
  title: string;
  marketplace: string;
  parentAsin: string | null;
  familyKey: string;
  imageUrl: string | null;
  variationDimensions: string[];
  discoveryStatus: string;
  discoveredCount: number;
  provider: string;
  isSimulated: boolean;
  favorite: boolean;
  archivedAt: string | null;
  createdAt: string;
  brandName: string | null;
  isReference: boolean;
  categoryName: string | null;
}

interface RuleRow {
  id: string;
  name: string;
  type: string;
  paused: boolean;
  group_name: string | null;
  event_count: number;
}

type Tab = "variants" | "history" | "offers" | "quality";
type Sort = "label" | "price" | "unit" | "ch7" | "stock";

export function ProductDetail({ family: f, variants, observations, rules, focusVariant }: { family: FamilyInfo; variants: VariantRow[]; observations: Record<string, LatestObservation>; rules: RuleRow[]; focusVariant: string | null }) {
  const router = useRouter();
  const tray = useCompareTray();
  const { refresh, refreshing } = useRefresh();
  const [tab, setTab] = useState<Tab>("variants");
  const [basis, setBasis] = useState<string>("auto");
  const [sort, setSort] = useState<Sort>("label");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showHidden, setShowHidden] = useState(false);
  const mp = isMarketplaceCode(f.marketplace) ? MARKETPLACES[f.marketplace] : null;
  const tracked = variants.filter((v) => v.tracked);
  const monitored = variants.filter((v) => v.checkIntervalMinutes !== null && v.tracked);

  const dims = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const v of variants) for (const [k, val] of Object.entries(v.attributes)) m.set(k, (m.get(k) ?? new Set()).add(val));
    return [...m.entries()].filter(([, s]) => s.size > 1);
  }, [variants]);

  const unitFor = (v: VariantRow) => {
    if (basis === "auto") return unitOf(v);
    const b = basis as NormalizationBasis;
    return { minor: unitPriceMinor(v.priceMinor, v.quantities, b), label: NORMALIZATION_BASES[b].label, basis: b };
  };

  const shown = useMemo(() => {
    const list = variants.filter((v) => (showHidden || !v.hidden) && Object.entries(filters).every(([k, val]) => v.attributes[k] === val));
    const key = (v: VariantRow) => {
      switch (sort) {
        case "price": return v.priceMinor ?? Infinity;
        case "unit": return unitFor(v).minor ?? Infinity;
        case "ch7": return pctChange(v.p7, v.priceMinor) ?? Infinity;
        case "stock": return v.availability === "in_stock" ? 0 : 1;
        default: return 0;
      }
    };
    return sort === "label" ? list : [...list].sort((a, b) => key(a) - key(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, filters, sort, showHidden, basis]);

  const best = useMemo(() => {
    let b: { id: string; unit: number } | null = null;
    for (const v of shown) {
      const u = unitFor(v);
      if (u.minor !== null && v.availability !== "out_of_stock" && (!b || u.minor < b.unit)) b = { id: v.variantId, unit: u.minor };
    }
    return shown.length > 1 ? b : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, basis]);

  async function patchVariant(ids: string[], patch: Record<string, unknown>, message?: string) {
    try {
      await api("/api/variants", { method: "PATCH", body: { ids, patch } });
      if (message) toast.success(message);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save that change.");
    }
  }

  async function patchFamily(patch: Record<string, unknown>) {
    await api("/api/families", { method: "PATCH", body: { ids: [f.id], patch } });
    router.refresh();
  }

  const lowestPrice = shown.filter((v) => v.priceMinor !== null && v.currency === shown[0]?.currency).sort((a, b) => a.priceMinor! - b.priceMinor!)[0];
  const discoveryCopy = {
    complete: { tone: "good" as const, text: `All ${f.discoveredCount} variations reported by the provider were discovered.` },
    partial: { tone: "warn" as const, text: "Variant discovery is partial — the provider reported more variations than it returned details for. Don't treat this list as the complete Amazon family." },
    unavailable: { tone: "neutral" as const, text: "The provider couldn't list this product's variations. Only the imported listing is shown." },
    single: { tone: "neutral" as const, text: "This listing has no variations on Amazon." },
  }[f.discoveryStatus] ?? { tone: "neutral" as const, text: "" };

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> Products
      </Link>

      {/* Header */}
      <header className="flex flex-col gap-6 md:flex-row md:items-start">
        <ViewTransition name={`product-${f.id}`} share="morph" default="none">
          <div className="shrink-0">
            <ProductImage src={f.imageUrl} alt={f.title} size={148} rounded={24} className="shadow-[var(--shadow-md)]" />
          </div>
        </ViewTransition>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.gentle, delay: 0.08 }} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/brands?brand=${encodeURIComponent(f.brandName ?? "")}`} className="font-medium text-ink-2 hover:text-accent">{f.brandName ?? "Unbranded"}</Link>
            {f.isReference && <Badge tone="accent" size="xs">Reference brand</Badge>}
            {f.isSimulated && <SimulatedBadge />}
            {f.archivedAt && <Badge tone="neutral" size="xs">Archived</Badge>}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight md:text-[28px]">{f.title}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-3">
            {mp && <MarketplaceTag code={f.marketplace} showName />}
            {f.categoryName && <span>{f.categoryName}</span>}
            <span className="num">{f.parentAsin ? `Parent ASIN ${f.parentAsin}` : `ASIN ${f.familyKey}`}</span>
            <span>
              {monitored.length} of {variants.length} variants monitored · via {f.provider === "demo" ? "demo data" : f.provider}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-end gap-6">
            <div>
              <div className="eyebrow">From</div>
              <div className="mt-0.5 text-3xl font-semibold tracking-tight">
                {lowestPrice ? <AnimatedNumber value={lowestPrice.priceMinor} format={(n) => formatMoney(Math.round(n), lowestPrice.currency ?? "INR")} /> : <span className="text-ink-4">—</span>}
              </div>
            </div>
            {best && (
              <div>
                <div className="eyebrow">Best unit value</div>
                <div className="num mt-1 text-md font-semibold">
                  {formatMoney(best.unit, shown[0]?.currency ?? "INR", undefined, { trimZeros: false })}
                  <span className="text-sm font-normal text-ink-3">{unitFor(shown.find((v) => v.variantId === best.id)!).label}</span>
                </div>
                <div className="text-xs text-ink-3">{shown.find((v) => v.variantId === best.id)?.label}</div>
              </div>
            )}
          </div>
        </motion.div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button onClick={() => refresh(tracked.map((v) => v.variantId))} loading={refreshing} disabled={!tracked.length}>
            <RefreshCw className="size-3.5" /> Refresh now
          </Button>
          <Button
            onClick={() => {
              tray.add(tracked.filter((v) => !v.hidden).map((v) => ({ variantId: v.variantId, label: v.label, brandName: v.brandName, imageUrl: v.imageUrl, marketplace: v.marketplace })));
              toast(`${tracked.length} variant${tracked.length === 1 ? "" : "s"} added to the comparison tray`);
            }}
          >
            <BarChart3 className="size-3.5" /> Compare
          </Button>
          <Menu align="end" trigger={<Button size="icon" aria-label="More actions"><MoreHorizontal className="size-4" /></Button>}>
            <MenuItem icon={<Star />} onSelect={() => patchFamily({ favorite: !f.favorite })}>{f.favorite ? "Remove from favorites" : "Add to favorites"}</MenuItem>
            <MenuItem icon={<Bell />} onSelect={() => router.push(`/alerts?new=1&variant=${tracked[0]?.variantId ?? ""}`)}>Create alert…</MenuItem>
            {mp && <MenuItem icon={<ExternalLink />} onSelect={() => window.open(listingUrl(f.marketplace as never, variants[0]?.asin ?? f.familyKey), "_blank", "noopener")}>Open on Amazon</MenuItem>}
            <MenuSeparator />
            <MenuItem
              icon={<Archive />}
              destructive={!f.archivedAt}
              onSelect={async () => {
                await patchFamily({ archived: !f.archivedAt });
                if (!f.archivedAt) {
                  toast("Product archived", { description: "Monitoring paused; history kept.", action: { label: "Undo", onClick: () => patchFamily({ archived: false }) } });
                  router.push("/products");
                }
              }}
            >
              {f.archivedAt ? "Restore product" : "Archive product"}
            </MenuItem>
          </Menu>
        </div>
      </header>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "variants", label: "Variants", count: variants.length },
          { value: "history", label: "Price history" },
          { value: "offers", label: "Offers & sellers" },
          { value: "quality", label: "Monitoring & data" },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          {tab === "variants" && (
            <div className="space-y-4">
              <div className={cn("flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-xs", discoveryCopy.tone === "warn" ? "bg-warn-soft text-ink" : "bg-surface-2 text-ink-2 shadow-[var(--ring-inset)]")}>
                {discoveryCopy.tone === "good" ? <CheckCircle2 className="mt-px size-4 shrink-0 text-good" /> : <Info className={cn("mt-px size-4 shrink-0", discoveryCopy.tone === "warn" ? "text-warn" : "text-ink-3")} />}
                <span>{discoveryCopy.text}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {dims.map(([dim, vals]) => (
                  <Segmented
                    key={dim}
                    ariaLabel={`Filter by ${dim}`}
                    size="sm"
                    value={filters[dim] ?? "__all"}
                    onChange={(v) => setFilters((x) => { const n = { ...x }; if (v === "__all") delete n[dim]; else n[dim] = v; return n; })}
                    options={[{ value: "__all", label: `All ${dim.toLowerCase()}s` }, ...[...vals].map((v) => ({ value: v, label: v }))]}
                  />
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-ink-3">Unit price</span>
                  <Select ariaLabel="Unit price basis" size="sm" value={basis} onValueChange={setBasis} options={[{ value: "auto", label: "Automatic" }, ...Object.entries(NORMALIZATION_BASES).map(([k, v]) => ({ value: k, label: v.long }))]} />
                  {variants.some((v) => v.hidden) && (
                    <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                      {showHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {showHidden ? "Hide hidden" : `Show hidden (${variants.filter((v) => v.hidden).length})`}
                    </Button>
                  )}
                </div>
              </div>

              <div className="card overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-ink-3 hairline-b">
                      <SortTh label="Variant" k="label" sort={sort} setSort={setSort} />
                      <th className="px-3 py-3 font-semibold">Quantity</th>
                      <SortTh label="Price" k="price" sort={sort} setSort={setSort} right />
                      <SortTh label="Unit price" k="unit" sort={sort} setSort={setSort} right />
                      <th className="px-3 py-3 text-right font-semibold">24h</th>
                      <SortTh label="7d" k="ch7" sort={sort} setSort={setSort} right />
                      <th className="px-3 py-3 text-right font-semibold">Lowest seen</th>
                      <SortTh label="Stock" k="stock" sort={sort} setSort={setSort} />
                      <th className="px-3 py-3 font-semibold">Monitoring</th>
                      <th className="w-10 px-3 py-3" />
                    </tr>
                  </thead>
                  <LayoutGroup>
                    <tbody>
                      {shown.map((v, i) => {
                        const u = unitFor(v);
                        const isBest = best?.id === v.variantId;
                        const focused = focusVariant === v.variantId;
                        return (
                          <motion.tr
                            key={v.variantId}
                            layout="position"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: v.hidden ? 0.5 : 1, y: 0 }}
                            transition={{ ...spring.layout, delay: staggerDelay(i, 0.03) }}
                            className={cn("group hairline-b transition-colors hover:bg-surface-2", focused && "bg-accent-softer", !v.tracked && "opacity-60")}
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-3">
                                <ProductImage src={v.imageUrl} alt="" size={38} rounded={10} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium">{v.label}</span>
                                    {isBest && (
                                      <Tooltip content="Lowest normalized price among in-stock variants shown, using stated pack sizes.">
                                        <span tabIndex={0}><Badge tone="good" size="xs">Best value</Badge></span>
                                      </Tooltip>
                                    )}
                                    {v.priority && (
                                      <Tooltip content="Priority: checked first when provider capacity is limited">
                                        <Star className="size-3 fill-accent text-accent" aria-label="Priority" />
                                      </Tooltip>
                                    )}
                                  </div>
                                  <div className="num text-2xs text-ink-3">{v.asin}{v.tags.length ? ` · ${v.tags.join(", ")}` : ""}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3"><QuantityEditor variantId={v.variantId} quantities={v.quantities} label={v.label} /></td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {v.priceMinor !== null && v.currency ? <AnimatedNumber value={v.priceMinor} format={(n) => formatMoney(Math.round(n), v.currency!)} /> : <Price minor={null} currency={null} />}
                              {v.listPriceMinor && v.priceMinor && v.priceMinor < v.listPriceMinor ? <div className="num text-2xs font-normal text-ink-3 line-through decoration-ink-4">{formatMoney(v.listPriceMinor, v.currency ?? "INR")}</div> : null}
                            </td>
                            <td className="num px-3 py-3 text-right text-xs text-ink-2">{u.minor !== null ? <>{formatMoney(u.minor, v.currency ?? "INR", undefined, { trimZeros: false })}<span className="text-ink-3">{u.label}</span></> : <span className="text-ink-4" title="Quantity unknown or in a different unit">—</span>}</td>
                            <td className="px-3 py-3 text-right"><Delta ratio={pctChange(v.p24, v.priceMinor)} /></td>
                            <td className="px-3 py-3 text-right"><Delta ratio={pctChange(v.p7, v.priceMinor)} /></td>
                            <td className="px-3 py-3 text-right text-xs"><Price minor={v.lowest} currency={v.currency} muted /></td>
                            <td className="px-3 py-3"><StockBadge availability={v.availability} /></td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2.5">
                                <Switch size="sm" checked={v.tracked && v.intervalMinutes !== null} onCheckedChange={(on) => patchVariant([v.variantId], on ? { tracked: true, intervalMinutes: v.intervalMinutes ?? 60 } : { intervalMinutes: null }, on ? "Monitoring resumed" : "Monitoring paused")} label={`Monitor ${v.label}`} />
                                <Freshness state={v.freshness} lastSuccessAt={v.lastSuccessAt} providerUpdatedAt={v.providerUpdatedAt} observedAt={v.lastObservedAt} nextCheckAt={v.nextCheckAt} />
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              <Menu align="end" trigger={<button className="flex size-7 items-center justify-center rounded-[7px] text-ink-3 opacity-60 hover:bg-[var(--hairline)] group-hover:opacity-100" aria-label={`Actions for ${v.label}`}><ChevronDown className="size-4" /></button>}>
                                <MenuItem icon={<BarChart3 />} onSelect={() => tray.toggle({ variantId: v.variantId, label: v.label, brandName: v.brandName, imageUrl: v.imageUrl, marketplace: v.marketplace })}>{tray.has(v.variantId) ? "Remove from compare" : "Add to compare"}</MenuItem>
                                <MenuItem icon={<RefreshCw />} onSelect={() => refresh([v.variantId])}>Refresh this variant</MenuItem>
                                <MenuItem icon={<Star />} onSelect={() => patchVariant([v.variantId], { priority: !v.priority }, v.priority ? "Priority removed" : "Marked as priority")}>{v.priority ? "Remove priority" : "Mark as priority"}</MenuItem>
                                <MenuItem icon={<Bell />} onSelect={() => router.push(`/alerts?new=1&variant=${v.variantId}`)}>Create alert…</MenuItem>
                                <MenuItem icon={v.hidden ? <Eye /> : <EyeOff />} onSelect={() => patchVariant([v.variantId], { hidden: !v.hidden })}>{v.hidden ? "Show variant" : "Hide variant"}</MenuItem>
                                <MenuItem
                                  icon={<Archive />}
                                  onSelect={() =>
                                    patchVariant([v.variantId], { tracked: !v.tracked }).then(() =>
                                      toast(v.tracked ? `Stopped tracking ${v.label}` : `Tracking ${v.label}`, { action: { label: "Undo", onClick: () => patchVariant([v.variantId], { tracked: v.tracked }) } }),
                                    )
                                  }
                                >
                                  {v.tracked ? "Stop tracking" : "Track variant"}
                                </MenuItem>
                                {mp && <MenuItem icon={<ExternalLink />} onSelect={() => window.open(listingUrl(f.marketplace as never, v.asin), "_blank", "noopener")}>Open on Amazon</MenuItem>}
                              </Menu>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </LayoutGroup>
                </table>
              </div>

              {(rules.length > 0 || variants.some((v) => v.groups.length)) && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="card p-4">
                    <div className="text-sm font-semibold">In comparisons</div>
                    <ul className="mt-2 space-y-1">
                      {[...new Map(variants.flatMap((v) => v.groups).map((g) => [g.id, g])).values()].map((g) => (
                        <li key={g.id}><Link href={`/comparisons/${g.id}`} className="flex items-center gap-2 text-sm text-accent hover:underline"><BarChart3 className="size-3.5" />{g.name}</Link></li>
                      ))}
                      {!variants.some((v) => v.groups.length) && <li className="text-sm text-ink-3">Not in any comparison yet.</li>}
                    </ul>
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold">Alerts watching this product</div>
                    <ul className="mt-2 space-y-1">
                      {rules.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 text-sm"><Bell className="size-3.5 text-ink-3" />{r.name}{r.group_name && <span className="text-xs text-ink-3">via {r.group_name}</span>}{r.paused && <Badge size="xs">Paused</Badge>}</li>
                      ))}
                      {!rules.length && <li className="text-sm text-ink-3">No alerts. <Link href={`/alerts?new=1&variant=${tracked[0]?.variantId ?? ""}`} className="text-accent">Create one</Link></li>}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="card p-5">
              <PriceHistory options={variants.filter((v) => !v.hidden).map((v) => ({ variantId: v.variantId, name: v.label, brandName: v.brandName, isReference: v.isReferenceBrand }))} initialSelected={variants.filter((v) => !v.hidden).slice(0, 8).map((v) => v.variantId)} colorBy="series" defaultRange="30d" />
            </div>
          )}

          {tab === "offers" && <Offers variants={variants} observations={observations} />}

          {tab === "quality" && (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-3 hairline-b">
                    {["Variant", "Freshness", "Interval", "Aisle checked", "Provider updated", "Observed", "Next check", "Observations", "Qty source", "Last error"].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.variantId} className="hairline-b">
                      <td className="px-3 py-2.5 font-medium">{v.label}</td>
                      <td className="px-3 py-2.5"><Freshness state={v.freshness} variant="badge" lastSuccessAt={v.lastSuccessAt} providerUpdatedAt={v.providerUpdatedAt} observedAt={v.lastObservedAt} nextCheckAt={v.nextCheckAt} /></td>
                      <td className="px-3 py-2.5">
                        <Select ariaLabel={`Interval for ${v.label}`} size="sm" value={v.intervalMinutes === null ? "paused" : String(v.intervalMinutes)} onValueChange={(val) => patchVariant([v.variantId], { intervalMinutes: val === "paused" ? null : Number(val) }, "Schedule updated")} options={[{ value: "60", label: "Hourly" }, { value: "180", label: "3 hours" }, { value: "360", label: "6 hours" }, { value: "720", label: "12 hours" }, { value: "1440", label: "Daily" }, { value: "paused", label: "Paused" }]} />
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{relativeTime(v.lastSuccessAt)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{v.providerUpdatedAt ? relativeTime(v.providerUpdatedAt) : "not reported"}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{relativeTime(v.lastObservedAt)}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-2">{v.nextCheckAt ? relativeTime(v.nextCheckAt) : "—"}</td>
                      <td className="num px-3 py-2.5 text-xs">{v.observationCount.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-xs">{v.quantities[0] ? <Badge tone={v.quantities[0].confidence === "manual" ? "good" : "neutral"} size="xs">{v.quantities[0].confidence}</Badge> : <span className="text-warn">missing</span>}</td>
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-bad" title={v.lastError ?? undefined}>{v.lastError ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-xs text-ink-3">Aisle requests data on schedule, but a successful request only means the provider answered — “Provider updated” is when the provider last refreshed its own copy from Amazon.</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="pt-2">
        <ButtonLink href="/products" variant="ghost" size="sm"><ArrowLeft className="size-3.5" /> Back to library</ButtonLink>
      </div>
    </div>
  );
}

function SortTh({ label, k, sort, setSort, right }: { label: string; k: Sort; sort: Sort; setSort: (s: Sort) => void; right?: boolean }) {
  return (
    <th className={cn("px-3 py-3 font-semibold", right && "text-right")} aria-sort={sort === k ? "ascending" : "none"}>
      <button onClick={() => setSort(sort === k ? "label" : k)} className={cn("uppercase tracking-wide transition-colors hover:text-ink", sort === k && "text-ink")}>
        {label}{sort === k ? " ↑" : ""}
      </button>
    </th>
  );
}

function Offers({ variants, observations }: { variants: VariantRow[]; observations: Record<string, LatestObservation> }) {
  const types: { key: keyof LatestObservation; label: string; hint: string }[] = [
    { key: "priceMinor", label: "Featured price", hint: "The price Aisle uses for analytics; see 'Basis' for which offer it is" },
    { key: "amazonPriceMinor", label: "Amazon as seller", hint: "Price when Amazon itself is the seller" },
    { key: "lowestNewPriceMinor", label: "Lowest new", hint: "Lowest new-condition offer from any seller" },
    { key: "listPriceMinor", label: "List / reference", hint: "Reference price shown on the listing" },
    { key: "dealPriceMinor", label: "Lightning deal", hint: "Only when a deal was observed" },
    { key: "primeExclusivePriceMinor", label: "Prime exclusive", hint: "Prime-only price where the provider reports it" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex gap-2.5 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-xs text-ink-2 shadow-[var(--ring-inset)]">
        <Info className="mt-px size-4 shrink-0 text-ink-3" />
        <span>Aisle doesn’t compute a universal checkout price: tax, delivery location, Prime eligibility and coupon redemption aren’t known. “Not reported” means the provider didn’t supply that price type — not that it doesn’t exist.</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-3 hairline-b">
              <th className="px-3 py-3 font-semibold">Variant</th>
              {types.map((t) => (
                <th key={t.key} className="px-3 py-3 text-right font-semibold">
                  <Tooltip content={t.hint}><span tabIndex={0} className="underline decoration-dotted decoration-ink-4 underline-offset-[3px]">{t.label}</span></Tooltip>
                </th>
              ))}
              <th className="px-3 py-3 font-semibold">Basis</th>
              <th className="px-3 py-3 font-semibold">Seller</th>
              <th className="px-3 py-3 text-right font-semibold">Shipping</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const o = observations[v.listingId];
              return (
                <tr key={v.variantId} className="hairline-b">
                  <td className="px-3 py-2.5 font-medium">{v.label}</td>
                  {types.map((t) => {
                    const val = o?.[t.key] as number | null | undefined;
                    return <td key={t.key} className="num px-3 py-2.5 text-right">{val != null ? formatMoney(val, o!.currency) : <span className="text-2xs text-ink-4">Not reported</span>}</td>;
                  })}
                  <td className="px-3 py-2.5 text-xs text-ink-2">{o ? o.priceBasis.replace("_", " ") : "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {o?.sellerName ? (
                      <span className="flex items-center gap-1.5">{o.sellerName}<Badge tone={o.sellerIsAmazon ? "accent" : "neutral"} size="xs">{o.sellerIsAmazon ? "Amazon retail" : "3rd party"}</Badge></span>
                    ) : (
                      <span className="text-ink-4">Not reported</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-xs">{o?.shippingMinor != null ? (o.shippingMinor === 0 ? "Free" : formatMoney(o.shippingMinor, o.currency)) : <span className="text-ink-4">Not reported</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
