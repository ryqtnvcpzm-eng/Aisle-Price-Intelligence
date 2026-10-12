"use client";

import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Bell, Check, ChevronDown, Download, GripVertical, Lightbulb, Link2, ListOrdered, Plus, Search, Sparkles, TrendingDown, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { reasonCopy, type ComparisonResult, type ComparisonRow } from "@/lib/comparison";
import { formatMoney, formatPct, pctChange } from "@/lib/money";
import { formatQuantity, NORMALIZATION_BASES, type NormalizationBasis } from "@/lib/quantity";
import { brandColorMap, OTHER_VAR } from "@/lib/series-colors";
import type { VariantRow } from "@/server/catalog/queries";
import type { GroupItemRow } from "@/server/comparison/service";
import { PriceHistory } from "../charts/price-history";
import { useImport } from "../import/import-context";
import { spring, staggerDelay } from "../motion/tokens";
import { QuantityEditor } from "../products/quantity-editor";
import { AnimatedNumber } from "../ui/animated-number";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ColumnsMenu, SortHeader, td, th } from "../ui/data-table";
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "../ui/popover";
import { Delta, Price } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { Segmented } from "../ui/segmented";
import { Select } from "../ui/select";
import { Freshness, MarketplaceTag, SimulatedBadge, StockBadge } from "../ui/status";
import { Tooltip } from "../ui/tooltip";
import { ComparisonVisual } from "./comparison-visual";

interface Detail {
  group: { id: string; name: string; description: string | null; basis: string; referenceBrandId: string | null; marketplace: string | null; updatedAt: string };
  items: GroupItemRow[];
  result: ComparisonResult;
  referenceBrand: { id: string; name: string } | null;
}

type View = "table" | "visual" | "timeline";
type Row = ComparisonRow & { item: GroupItemRow };

export function ComparisonWorkspace({ detail, brands }: { detail: Detail; brands: { id: string; name: string; isReference: boolean }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const importer = useImport();
  const { group, items, result } = detail;
  const [view, setView] = useState<View>("table");
  const [arranging, setArranging] = useState(false);
  const [name, setName] = useState(group.name);
  const [editingName, setEditingName] = useState(false);
  const basis = result.basis as NormalizationBasis;
  const unitLabel = NORMALIZATION_BASES[basis].label;
  const cur = result.currency ?? "INR";
  const simulated = items.some((i) => i.isSimulated);

  useEffect(() => {
    if (params.get("created") === "1") {
      toast.success("Comparison created", { description: "Every listing is ranked on a normalized basis. Monitoring continues hourly." });
      router.replace(`/comparisons/${group.id}`);
    }
  }, [params, router, group.id]);

  const colors = useMemo(() => brandColorMap(items.map((i) => ({ name: i.brandName, isReference: i.role === "reference" }))), [items]);
  const colorFor = (b: string | null) => colors.get(b ?? "") ?? OTHER_VAR;

  async function patchGroup(body: Record<string, unknown>, msg?: string) {
    try {
      await api(`/api/groups/${group.id}`, { method: "PATCH", body });
      if (msg) toast.success(msg);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save.");
    }
  }
  async function patchItem(itemId: string, body: Record<string, unknown>) {
    await api(`/api/groups/${group.id}/items/${itemId}`, { method: "PATCH", body });
    router.refresh();
  }
  async function removeItems(variantIds: string[]) {
    await api(`/api/groups/${group.id}/items`, { method: "DELETE", body: { variantIds } });
    router.refresh();
    toast(`Removed ${variantIds.length} listing${variantIds.length === 1 ? "" : "s"}`, {
      action: { label: "Undo", onClick: async () => { await api(`/api/groups/${group.id}/items`, { method: "POST", body: { variantIds } }); router.refresh(); } },
    });
  }
  async function exportAs(format: "csv" | "xlsx" | "pdf") {
    const t = toast.loading("Preparing report…");
    const res = await fetch("/api/reports/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "competitive_snapshot", groupId: group.id, format }) });
    toast.dismiss(t);
    if (!res.ok) return toast.error("Export failed.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `comparison.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Report downloaded", { description: res.headers.get("X-Aisle-Simulated") === "1" ? "Contains simulated demo data — labelled in the file." : undefined });
  }

  const ref = result.referenceBest;
  const confirmedCount = items.filter((i) => i.status === "confirmed").length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
      <Link href="/comparisons" className="inline-flex items-center gap-1 text-sm text-ink-3 transition-colors hover:text-ink">
        <ArrowLeft className="size-4" /> Comparisons
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {simulated && <SimulatedBadge />}
            {group.marketplace && <MarketplaceTag code={group.marketplace} showName />}
          </div>
          {editingName ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { setEditingName(false); if (name.trim() && name !== group.name) void patchGroup({ name: name.trim() }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(group.name); setEditingName(false); } }}
              className="mt-1 w-full max-w-[640px] rounded-[10px] bg-surface px-2 py-0.5 -mx-2 text-2xl font-semibold tracking-tight outline-none shadow-[inset_0_0_0_1px_var(--accent)] md:text-3xl"
              aria-label="Comparison name"
            />
          ) : (
            <h1 onDoubleClick={() => setEditingName(true)} className="mt-1 cursor-text text-2xl font-semibold tracking-tight md:text-3xl" title="Double-click to rename">{group.name}</h1>
          )}
          <p className="mt-1 text-md text-ink-2">{group.description ?? `${confirmedCount} confirmed listings compared ${NORMALIZATION_BASES[basis].long}.`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select ariaLabel="Normalization basis" size="sm" value={basis} onValueChange={(v) => patchGroup({ basis: v }, "Basis updated — rankings recalculated")} options={Object.entries(NORMALIZATION_BASES).map(([k, v]) => ({ value: k, label: `Compare ${v.long}` }))} />
          <Select ariaLabel="Reference brand" size="sm" value={group.referenceBrandId ?? "auto"} onValueChange={(v) => patchGroup({ referenceBrandId: v === "auto" ? null : v }, "Reference brand updated")} options={[{ value: "auto", label: "Reference: workspace default" }, ...brands.map((b) => ({ value: b.id, label: `Reference: ${b.name}` }))]} />
          <AddListings groupId={group.id} existing={items.map((i) => i.variantId)} onPaste={() => importer.open(undefined, { groupId: group.id })} />
          <Menu align="end" trigger={<Button size="sm"><Download className="size-3.5" /> Export</Button>}>
            <MenuLabel>Competitive snapshot</MenuLabel>
            <MenuItem onSelect={() => exportAs("pdf")}>PDF report</MenuItem>
            <MenuItem onSelect={() => exportAs("xlsx")}>Excel workbook</MenuItem>
            <MenuItem onSelect={() => exportAs("csv")}>CSV</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Bell />} onSelect={() => router.push(`/alerts?new=1&group=${group.id}`)}>Create alert for this group…</MenuItem>
            <MenuItem destructive onSelect={async () => { await patchGroup({ archived: true }); toast("Comparison archived", { action: { label: "Undo", onClick: () => patchGroup({ archived: false }) } }); router.push("/comparisons"); }}>Archive comparison</MenuItem>
          </Menu>
        </div>
      </header>

      {/* Findings — plain English, each backed by the numbers it states */}
      {result.findings.length > 0 && (
        <section className="card divide-y divide-[var(--hairline)]" aria-label="Findings">
          {result.findings.map((f, i) => (
            <motion.div key={f.id} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring.gentle, delay: staggerDelay(i, 0.05) }} className="flex items-start gap-3 px-5 py-3.5">
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", f.tone === "warning" ? "bg-warn-soft text-warn" : f.tone === "negative" ? "bg-bad-soft text-bad" : f.tone === "positive" ? "bg-good-soft text-good" : "bg-accent-soft text-accent")}>
                {f.tone === "warning" ? <AlertTriangle className="size-3.5" /> : f.id === "cheapest" ? <TrendingDown className="size-3.5" /> : <Lightbulb className="size-3.5" />}
              </span>
              <p className="text-md leading-snug text-ink">{f.text}</p>
            </motion.div>
          ))}
        </section>
      )}

      {/* Summary metrics */}
      <section className="card grid grid-cols-2 md:grid-cols-5" aria-label="Summary">
        <Metric label="Comparable listings" value={<AnimatedNumber value={result.comparableCount} format={(n) => String(Math.round(n))} />} sub={`of ${items.length}`} />
        <Metric label={`Cheapest ${unitLabel}`} value={result.cheapest ? formatMoney(result.cheapest.unitPriceMinor, cur, undefined, { trimZeros: false }) : "—"} sub={result.cheapest ? `${result.cheapest.brandName ?? ""} ${result.cheapest.label}` : undefined} />
        <Metric label="Competitor median" value={result.competitorMedian !== null ? formatMoney(result.competitorMedian, cur, undefined, { trimZeros: false }) : "—"} sub={unitLabel} />
        <Metric label="Reference vs median" value={ref?.premium != null ? <span className={ref.premium > 0 ? "text-up" : "text-down"}>{formatPct(ref.premium, { signed: true })}</span> : "—"} sub={ref ? `${ref.brandName ?? ""} ${ref.label}` : "No reference listing"} />
        <Metric label="Spread" value={result.spread !== null ? formatPct(result.spread) : "—"} sub="cheapest → priciest" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<View> ariaLabel="View" value={view} onChange={(v) => { setView(v); setArranging(false); }} options={[{ value: "table", label: "Table" }, { value: "visual", label: "Visual" }, { value: "timeline", label: "Timeline" }]} />
        {view === "table" && (
          <Button variant={arranging ? "tinted" : "ghost"} size="sm" onClick={() => setArranging((v) => !v)} aria-pressed={arranging}>
            <ListOrdered className="size-3.5" /> {arranging ? "Done arranging" : "Arrange"}
          </Button>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${view}-${arranging}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {view === "table" && !arranging && <CompareTable result={result} items={items} unitLabel={unitLabel} colorFor={colorFor} onRole={(it, role) => patchItem(it.itemId, { role })} onConfirm={(it) => patchItem(it.itemId, { status: "confirmed" }).then(() => toast.success("Confirmed — now included in calculations"))} onRemove={(ids) => removeItems(ids)} />}
          {view === "table" && arranging && <Arrange groupId={group.id} items={items} />}
          {view === "visual" && <ComparisonVisual result={result} items={items} colorFor={colorFor} unitLabel={unitLabel} />}
          {view === "timeline" && <Timeline items={items} result={result} basis={basis} />}
        </motion.div>
      </AnimatePresence>

      <Suggestions groupId={group.id} />
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="p-4 [&:not(:last-child)]:shadow-[inset_-0.5px_0_0_var(--line)]">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="num mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-2xs text-ink-3">{sub}</div>}
    </div>
  );
}

const LABELS: Record<string, string> = { role: "Role", quantity: "Quantity", price: "Price", list: "List price", discount: "Discount", ch24: "24h", ch7: "7d", ch30: "30d", ch90: "90d", low: "Lowest seen", stock: "Stock", marketplace: "Marketplace", seller: "Seller", updated: "Last updated" };

function CompareTable({ result, items, unitLabel, colorFor, onRole, onConfirm, onRemove }: { result: ComparisonResult; items: GroupItemRow[]; unitLabel: string; colorFor: (b: string | null) => string; onRole: (it: GroupItemRow, role: "reference" | "competitor") => void; onConfirm: (it: GroupItemRow) => void; onRemove: (ids: string[]) => void }) {
  const cur = result.currency ?? "INR";
  const data: Row[] = useMemo(() => result.rows.map((r) => ({ ...r, item: items.find((i) => i.variantId === r.id)! })).filter((r) => r.item), [result, items]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "rank", desc: false }]);
  const [visibility, setVisibility] = useState<VisibilityState>({ ch30: false, ch90: false, marketplace: false, seller: false, list: false });
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "rank", accessorFn: (r) => r.rank ?? 999, enableHiding: false, header: ({ column }) => <SortHeader column={column} label="#" />, cell: ({ row: { original: r } }) => <span className="num text-xs font-semibold text-ink-3">{r.rank ?? "–"}</span> },
      {
        id: "listing",
        enableHiding: false,
        accessorFn: (r) => `${r.brandName ?? ""} ${r.label} ${r.productTitle}`,
        header: ({ column }) => <SortHeader column={column} label="Listing" />,
        cell: ({ row: { original: r } }) => (
          <div className="flex min-w-[250px] items-center gap-3">
            <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: colorFor(r.brandName) }} aria-hidden />
            <ProductImage src={r.item.imageUrl} alt="" size={34} rounded={9} />
            <div className="min-w-0">
              <Link href={`/products/${r.item.familyId}?variant=${r.id}`} className="flex items-center gap-1.5 text-sm font-medium hover:text-accent">
                <span className="truncate">{r.brandName ?? "Unbranded"} · {r.label}</span>
              </Link>
              <div className="max-w-[300px] truncate text-xs text-ink-3">{r.productTitle}</div>
            </div>
          </div>
        ),
      },
      {
        id: "role",
        accessorKey: "role",
        header: ({ column }) => <SortHeader column={column} label="Role" />,
        cell: ({ row: { original: r } }) =>
          r.status === "suggested" ? (
            <Badge tone="warn" size="xs">Suggested</Badge>
          ) : (
            <button onClick={() => onRole(r.item, r.role === "reference" ? "competitor" : "reference")} className="outline-none" title="Click to switch role">
              <Badge tone={r.role === "reference" ? "accent" : "neutral"} size="xs">{r.role === "reference" ? "Reference" : "Competitor"}</Badge>
            </button>
          ),
      },
      { id: "quantity", accessorFn: (r) => r.item.quantities[0]?.totalMilli ?? null, header: ({ column }) => <SortHeader column={column} label="Quantity" />, cell: ({ row: { original: r } }) => <QuantityEditor variantId={r.id} quantities={r.item.quantities} label={r.label} /> },
      { id: "price", accessorKey: "priceMinor", sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="Price" align="right" />, cell: ({ row: { original: r } }) => <div className="text-right font-medium"><Price minor={r.priceMinor} currency={r.currency} /></div> },
      {
        id: "unit",
        accessorKey: "unitPriceMinor",
        sortUndefined: "last",
        enableHiding: false,
        header: ({ column }) => <SortHeader column={column} label={`Unit ${unitLabel}`} align="right" hint="Price ÷ stated pack quantity. Parsed quantities are unverified until corrected." />,
        cell: ({ row: { original: r } }) =>
          r.comparable ? (
            <div className="num text-right font-semibold">{formatMoney(r.unitPriceMinor, cur, undefined, { trimZeros: false })}</div>
          ) : (
            <Tooltip content={reasonCopy(r.reason)}>
              <div tabIndex={0} className="text-right text-xs text-ink-4 underline decoration-dotted underline-offset-2">excluded</div>
            </Tooltip>
          ),
      },
      {
        id: "premium",
        accessorKey: "premium",
        sortUndefined: "last",
        header: ({ column }) => <SortHeader column={column} label="vs median" align="right" hint="Premium or discount versus the median of comparable competitor listings" />,
        cell: ({ row: { original: r } }) => <div className="text-right">{r.premium === null ? <span className="text-ink-4">—</span> : <span className={cn("num text-xs font-medium", r.premium > 0.005 ? "text-up" : r.premium < -0.005 ? "text-down" : "text-ink-3")}>{formatPct(r.premium, { signed: true })}</span>}</div>,
      },
      { id: "list", accessorFn: (r) => r.item.listPriceMinor, header: ({ column }) => <SortHeader column={column} label="List" align="right" />, cell: ({ row: { original: r } }) => <div className="text-right text-xs"><Price minor={r.item.listPriceMinor} currency={r.currency} muted /></div> },
      { id: "discount", accessorFn: (r) => (r.item.listPriceMinor && r.priceMinor ? (r.item.listPriceMinor - r.priceMinor) / r.item.listPriceMinor : null), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="Discount" align="right" hint="Below the listing's own reference price" />, cell: ({ getValue }) => <div className="num text-right text-xs text-ink-2">{getValue<number | null>() === null ? "—" : formatPct(getValue<number>())}</div> },
      { id: "ch24", accessorFn: (r) => pctChange(r.item.p24, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="24h" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "ch7", accessorFn: (r) => pctChange(r.item.p7, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="7d" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "ch30", accessorFn: (r) => pctChange(r.item.p30, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="30d" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "ch90", accessorFn: (r) => pctChange(r.item.p90, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="90d" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "low", accessorFn: (r) => r.item.lowest, header: ({ column }) => <SortHeader column={column} label="Lowest" align="right" />, cell: ({ row: { original: r } }) => <div className="text-right text-xs"><Price minor={r.item.lowest} currency={r.currency} muted /></div> },
      { id: "stock", accessorKey: "availability", header: ({ column }) => <SortHeader column={column} label="Stock" />, cell: ({ getValue }) => <StockBadge availability={getValue<string>()} /> },
      { id: "marketplace", accessorFn: (r) => r.item.marketplace, header: ({ column }) => <SortHeader column={column} label="Market" />, cell: ({ getValue }) => <MarketplaceTag code={getValue<string>()} /> },
      { id: "seller", accessorFn: (r) => r.item.sellerName, header: ({ column }) => <SortHeader column={column} label="Seller" />, cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-xs text-ink-2">{r.item.buyBoxIsAmazon ? "Amazon" : (r.item.sellerName ?? "—")}</span> },
      { id: "updated", accessorFn: (r) => r.item.lastObservedAt, header: ({ column }) => <SortHeader column={column} label="Updated" />, cell: ({ row: { original: r } }) => <Freshness state={r.item.freshness} lastSuccessAt={r.item.lastSuccessAt} providerUpdatedAt={r.item.providerUpdatedAt} observedAt={r.item.lastObservedAt} nextCheckAt={r.item.nextCheckAt} /> },
      {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: () => null,
        cell: ({ row: { original: r } }) => (
          <div className="flex justify-end gap-1">
            {r.status === "suggested" && (
              <Button size="xs" variant="tinted" onClick={() => onConfirm(r.item)}>
                <Check className="size-3" /> Confirm
              </Button>
            )}
            <Tooltip content="Remove from comparison">
              <button onClick={() => onRemove([r.id])} className="flex size-6 items-center justify-center rounded-[6px] text-ink-4 opacity-0 transition-opacity hover:bg-[var(--hairline)] hover:text-ink group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${r.label}`}>
                <X className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        ),
      },
    ],
    [colorFor, cur, unitLabel, onRole, onConfirm, onRemove],
  );

  const table = useReactTable({ data, columns, state: { sorting, columnVisibility: visibility, globalFilter: filter }, onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, onGlobalFilterChange: setFilter, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(), getRowId: (r) => r.id, globalFilterFn: (row, _c, v) => `${row.original.brandName} ${row.original.label} ${row.original.productTitle}`.toLowerCase().includes(String(v).toLowerCase()) });

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 hairline-b">
        <div className="relative w-[240px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter listings…" aria-label="Filter listings" className="h-7 w-full rounded-[8px] bg-surface-2 pl-7 pr-2 text-sm outline-none shadow-[inset_0_0_0_0.5px_var(--line)] focus:shadow-[inset_0_0_0_1px_var(--accent)]" />
        </div>
        <span className="text-xs text-ink-3">Rows outside the basis or currency stay visible but are excluded from rankings.</span>
        <div className="ml-auto"><ColumnsMenu table={table} labels={LABELS} /></div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => <th key={h.id} className={th}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</th>)}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <motion.tr key={row.id} layout="position" transition={spring.layout} className={cn("group transition-colors hover:bg-surface-2 [&>td]:shadow-[inset_0_-0.5px_0_var(--hairline)]", row.original.role === "reference" && row.original.status === "confirmed" && "bg-accent-softer", !row.original.comparable && "text-ink-3")}>
                {row.getVisibleCells().map((c) => <td key={c.id} className={td}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Arrange mode: drag to reorder (pointer) or use the arrow buttons (keyboard/touch). */
function Arrange({ groupId, items }: { groupId: string; items: GroupItemRow[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(items);
  async function persist(next: GroupItemRow[]) {
    setOrder(next);
    await api(`/api/groups/${groupId}/reorder`, { method: "POST", body: { itemIds: next.map((i) => i.itemId) } });
    router.refresh();
  }
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void persist(next);
  };
  return (
    <div className="card p-2">
      <p className="px-3 pb-2 pt-2 text-xs text-ink-3">Drag listings to set the order used in tables, exports and charts. Rankings still compute from prices.</p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-1">
        {order.map((it, i) => (
          <ArrangeRow key={it.itemId} item={it} onDrop={() => persist(order)} onUp={() => move(i, -1)} onDown={() => move(i, 1)} />
        ))}
      </Reorder.Group>
    </div>
  );
}

function ArrangeRow({ item, onDrop, onUp, onDown }: { item: GroupItemRow; onDrop: () => void; onUp: () => void; onDown: () => void }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={item} dragListener={false} dragControls={controls} onDragEnd={onDrop} transition={spring.layout} whileDrag={{ scale: 1.015, boxShadow: "var(--shadow-lg)" }} className="flex items-center gap-3 rounded-[12px] bg-surface px-3 py-2 shadow-[var(--ring-inset)]">
      <button onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none text-ink-4 active:cursor-grabbing" aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <ProductImage src={item.imageUrl} alt="" size={30} rounded={8} />
      <span className="flex-1 truncate text-sm font-medium">{item.brandName} · {item.label}</span>
      <Button variant="ghost" size="icon-sm" onClick={onUp} aria-label="Move up"><ArrowUp className="size-3.5" /></Button>
      <Button variant="ghost" size="icon-sm" onClick={onDown} aria-label="Move down"><ArrowDown className="size-3.5" /></Button>
    </Reorder.Item>
  );
}

function Timeline({ items, result, basis }: { items: GroupItemRow[]; result: ComparisonResult; basis: NormalizationBasis }) {
  const [mode, setMode] = useState<"unit" | "price">("unit");
  const def = NORMALIZATION_BASES[basis];
  const confirmed = items.filter((i) => i.status === "confirmed");
  const unitScale = useMemo(() => {
    const m: Record<string, { num: number; den: number } | null> = {};
    for (const i of confirmed) {
      if (def.dimension === "pack") m[i.variantId] = { num: 1, den: i.quantities[0]?.packCount ?? 1 };
      else {
        const q = i.quantities.find((x) => x.dimension === def.dimension);
        m[i.variantId] = q && q.totalMilli > 0 ? { num: def.refMilli, den: q.totalMilli } : null;
      }
    }
    return m;
  }, [confirmed, def]);
  const excluded = confirmed.filter((i) => !unitScale[i.variantId]);
  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-md font-semibold tracking-tight">Price over time</div>
          <div className="text-xs text-ink-3">Toggle lines without losing your range. Colors follow brands; dashes separate a brand’s variants.</div>
        </div>
        <Segmented ariaLabel="Measure" size="sm" value={mode} onChange={setMode} options={[{ value: "unit", label: `Unit ${def.label}` }, { value: "price", label: "Shelf price" }]} />
      </div>
      <PriceHistory
        key={mode}
        options={confirmed.map((i) => ({ variantId: i.variantId, name: `${i.brandName ?? ""} · ${i.label}`, brandName: i.brandName, isReference: i.role === "reference" }))}
        initialSelected={confirmed.slice(0, 10).map((i) => i.variantId)}
        colorBy="brand"
        defaultRange="30d"
        unitScale={mode === "unit" ? unitScale : undefined}
        unitLabel={mode === "unit" ? def.label : undefined}
      />
      {mode === "unit" && excluded.length > 0 && <p className="text-xs text-ink-3">{excluded.length} listing(s) hidden from the unit view because their quantity isn’t expressed in this basis.</p>}
      {result.currency === null && <p className="text-xs text-warn">No priced listings yet.</p>}
    </div>
  );
}

function AddListings({ groupId, existing, onPaste }: { groupId: string; existing: string[]; onPaste: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["variants"], queryFn: () => api<{ rows: VariantRow[] }>("/api/variants"), enabled: open });
  const candidates = (data?.rows ?? []).filter((r) => r.tracked && !existing.includes(r.variantId) && `${r.brandName} ${r.familyTitle} ${r.label} ${r.asin}`.toLowerCase().includes(q.toLowerCase()));
  async function add(ids: string[]) {
    await api(`/api/groups/${groupId}/items`, { method: "POST", body: { variantIds: ids } });
    toast.success(`Added ${ids.length} listing${ids.length === 1 ? "" : "s"}`);
    router.refresh();
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(420px,calc(100vw-24px))] p-0"
      trigger={
        <Button variant="primary" size="sm">
          <Plus className="size-3.5" /> Add listings <ChevronDown className="size-3" />
        </Button>
      }
    >
      <div className="p-2">
        <button onClick={() => { setOpen(false); onPaste(); }} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--hairline)]">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-accent text-white"><Link2 className="size-4" /></span>
          <span>
            <span className="block text-sm font-medium">Paste Amazon links</span>
            <span className="block text-xs text-ink-3">Import new listings straight into this comparison</span>
          </span>
        </button>
      </div>
      <div className="px-3 pb-1 hairline-t pt-2.5">
        <div className="eyebrow mb-1.5">From your library</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracked variants…" className="h-8 w-full rounded-[8px] bg-surface-2 px-2.5 text-sm outline-none shadow-[inset_0_0_0_0.5px_var(--line)]" aria-label="Search tracked variants" />
      </div>
      <ul className="max-h-[300px] overflow-y-auto p-1.5">
        {candidates.slice(0, 40).map((r) => (
          <li key={r.variantId}>
            <button onClick={() => add([r.variantId])} className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left hover:bg-[var(--hairline)]">
              <ProductImage src={r.imageUrl} alt="" size={28} rounded={7} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.brandName} · {r.label}</span>
                <span className="block truncate text-2xs text-ink-3">{r.familyTitle}</span>
              </span>
              <Plus className="size-3.5 text-ink-3" />
            </button>
          </li>
        ))}
        {data && !candidates.length && <li className="px-3 py-6 text-center text-xs text-ink-3">Every tracked variant is already here.</li>}
      </ul>
    </Popover>
  );
}

function Suggestions({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { data, refetch } = useQuery({ queryKey: ["suggestions", groupId], queryFn: () => api<{ suggestions: { variant: VariantRow; score: number; reasons: string[] }[] }>(`/api/groups/${groupId}/suggestions`) });
  if (!data?.suggestions.length) return null;
  async function add(id: string, status: "confirmed" | "suggested") {
    await api(`/api/groups/${groupId}/items`, { method: "POST", body: { variantIds: [id], status } });
    toast.success(status === "confirmed" ? "Added as a confirmed match" : "Added as a suggestion — excluded until confirmed");
    await refetch();
    router.refresh();
  }
  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 text-accent" />
        <div>
          <h2 className="text-md font-semibold tracking-tight">Possibly comparable</h2>
          <p className="text-xs text-ink-3">Suggested from category and pack size — never title similarity. Nothing is added until you choose.</p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2 md:grid-cols-2">
        {data.suggestions.map((s) => (
          <li key={s.variant.variantId} className="flex items-center gap-3 rounded-[12px] bg-surface-2 p-2.5 shadow-[var(--ring-inset)]">
            <ProductImage src={s.variant.imageUrl} alt="" size={34} rounded={9} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.variant.brandName} · {s.variant.label}</div>
              <div className="truncate text-2xs text-ink-3">{s.reasons.join(" · ")} · {formatQuantity(s.variant.quantities[0])}</div>
            </div>
            <Button size="xs" variant="ghost" onClick={() => add(s.variant.variantId, "suggested")}>Suggest</Button>
            <Button size="xs" variant="tinted" onClick={() => add(s.variant.variantId, "confirmed")}>Confirm</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
