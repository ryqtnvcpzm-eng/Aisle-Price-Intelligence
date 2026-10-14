"use client";

import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type VisibilityState } from "@tanstack/react-table";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatMoney, pctChange } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import type { FamilySummary, VariantRow } from "@/server/catalog/queries";
import { spring } from "../motion/tokens";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { ColumnsMenu, SortHeader, td, th } from "../ui/data-table";
import { Delta, Price } from "../ui/price";
import { ProductImage } from "../ui/product-image";
import { CapturedBadge, Freshness, MarketplaceTag, StockBadge } from "../ui/status";
import { unitOf } from "./library-utils";

const LABELS: Record<string, string> = { asin: "ASIN", marketplace: "Marketplace", quantity: "Quantity", unit: "Unit price", list: "List price", ch24: "24h", ch7: "7d", ch30: "30d", low: "Lowest seen", stock: "Stock", freshness: "Freshness", seller: "Seller" };
const LS = "aisle-library-columns";

export function LibraryTable({ families, selected, onSelectionChange }: { families: FamilySummary[]; selected: Set<string>; onSelectionChange: (s: Set<string>) => void }) {
  const rows = useMemo(() => families.flatMap((f) => f.variants.filter((v) => !v.hidden)), [families]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>({ seller: false, ch30: false, marketplace: false });
  useEffect(() => {
    try {
      const v = localStorage.getItem(LS);
      if (v) setVisibility(JSON.parse(v));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(visibility));
    } catch {
      /* ignore */
    }
  }, [visibility]);

  const columns = useMemo<ColumnDef<VariantRow>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        enableSorting: false,
        header: () => {
          const all = rows.length > 0 && rows.every((r) => selected.has(r.variantId));
          const some = rows.some((r) => selected.has(r.variantId));
          return <Checkbox checked={all ? true : some ? "indeterminate" : false} onCheckedChange={(c) => onSelectionChange(new Set(c ? rows.map((r) => r.variantId) : []))} label="Select all rows" />;
        },
        cell: ({ row }) => <Checkbox checked={selected.has(row.original.variantId)} onCheckedChange={(c) => { const n = new Set(selected); if (c) n.add(row.original.variantId); else n.delete(row.original.variantId); onSelectionChange(n); }} label={`Select ${row.original.label}`} />,
      },
      {
        id: "product",
        enableHiding: false,
        accessorFn: (r) => `${r.brandName ?? ""} ${r.familyTitle}`,
        header: ({ column }) => <SortHeader column={column} label="Product" />,
        cell: ({ row: { original: r } }) => (
          <Link href={`/products/${r.familyId}?variant=${r.variantId}`} className="flex min-w-[260px] items-center gap-3 outline-none">
            <ProductImage src={r.imageUrl} alt="" size={36} rounded={9} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium hover:text-accent">{r.brandName ?? "Unbranded"} · {r.label}</span>
                {r.isReferenceBrand && <Badge tone="accent" size="xs">Ref</Badge>}
              </div>
              <div className="max-w-[340px] truncate text-xs text-ink-3">{r.familyTitle}</div>
            </div>
          </Link>
        ),
      },
      { id: "asin", accessorKey: "asin", header: ({ column }) => <SortHeader column={column} label="ASIN" />, cell: ({ getValue }) => <span className="num text-xs text-ink-2">{getValue<string>()}</span> },
      { id: "marketplace", accessorKey: "marketplace", header: ({ column }) => <SortHeader column={column} label="Market" />, cell: ({ getValue }) => <MarketplaceTag code={getValue<string>()} /> },
      {
        id: "quantity",
        accessorFn: (r) => r.quantities[0]?.totalMilli ?? null,
        header: ({ column }) => <SortHeader column={column} label="Quantity" hint="Parsed from listing text unless marked as corrected" />,
        cell: ({ row: { original: r } }) => (r.quantities[0] ? <span className="whitespace-nowrap text-xs text-ink-2" title={`${r.quantities[0].confidence}: “${r.quantities[0].matchedText}”`}>{formatQuantity(r.quantities[0])}{r.quantities[0].confidence === "manual" && " ✓"}</span> : <span className="text-xs text-warn">Unknown</span>),
      },
      { id: "price", accessorKey: "priceMinor", sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="Price" align="right" />, cell: ({ row: { original: r } }) => (
          <div className="flex items-center justify-end gap-1.5 font-semibold">
            {r.priceSource === "user-capture" && <CapturedBadge compact at={r.lastObservedAt} />}
            <Price minor={r.priceMinor} currency={r.currency} />
          </div>
        ) },
      {
        id: "unit",
        accessorFn: (r) => unitOf(r).minor,
        sortUndefined: "last",
        header: ({ column }) => <SortHeader column={column} label="Unit price" align="right" hint="Price normalized by each listing's own quantity unit" />,
        cell: ({ row: { original: r } }) => {
          const u = unitOf(r);
          return <div className="num text-right text-xs text-ink-2">{u.minor !== null ? `${formatMoney(u.minor, r.currency ?? "INR", undefined, { trimZeros: false })}${u.label}` : "—"}</div>;
        },
      },
      {
        id: "list",
        accessorKey: "listPriceMinor",
        header: ({ column }) => <SortHeader column={column} label="List" align="right" hint="Reference/list price as reported by the provider" />,
        cell: ({ row: { original: r } }) => (
          <div className="num text-right text-xs text-ink-3">
            {r.listPriceMinor ? formatMoney(r.listPriceMinor, r.currency ?? "INR") : "—"}
            {r.listPriceMinor && r.priceMinor && r.priceMinor < r.listPriceMinor ? <span className="ml-1 text-down">−{Math.round((1 - r.priceMinor / r.listPriceMinor) * 100)}%</span> : null}
          </div>
        ),
      },
      { id: "ch24", accessorFn: (r) => pctChange(r.p24, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="24h" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "ch7", accessorFn: (r) => pctChange(r.p7, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="7d" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "ch30", accessorFn: (r) => pctChange(r.p30, r.priceMinor), sortUndefined: "last", header: ({ column }) => <SortHeader column={column} label="30d" align="right" />, cell: ({ getValue }) => <div className="text-right"><Delta ratio={getValue<number | null>()} /></div> },
      { id: "low", accessorKey: "lowest", header: ({ column }) => <SortHeader column={column} label="Lowest" align="right" hint="Lowest price in Aisle's stored observations" />, cell: ({ row: { original: r } }) => <div className="text-right text-xs"><Price minor={r.lowest} currency={r.currency} muted /></div> },
      { id: "stock", accessorKey: "availability", header: ({ column }) => <SortHeader column={column} label="Stock" />, cell: ({ getValue }) => <StockBadge availability={getValue<string>()} /> },
      { id: "seller", accessorKey: "sellerName", header: ({ column }) => <SortHeader column={column} label="Seller" />, cell: ({ row: { original: r } }) => <span className="whitespace-nowrap text-xs text-ink-2">{r.buyBoxIsAmazon ? "Amazon" : (r.sellerName ?? "—")}</span> },
      { id: "freshness", accessorKey: "freshness", header: ({ column }) => <SortHeader column={column} label="Freshness" />, cell: ({ row: { original: r } }) => <Freshness state={r.freshness} lastSuccessAt={r.lastSuccessAt} providerUpdatedAt={r.providerUpdatedAt} observedAt={r.lastObservedAt} nextCheckAt={r.nextCheckAt} /> },
    ],
    [rows, selected, onSelectionChange],
  );

  const table = useReactTable({ data: rows, columns, state: { sorting, columnVisibility: visibility }, onSortingChange: setSorting, onColumnVisibilityChange: setVisibility, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (r) => r.variantId });
  // Animated reordering is lovely at small sizes; beyond that, prefer raw speed.
  const animateRows = rows.length <= 150;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-end px-2 py-1.5 hairline-b">
        <ColumnsMenu table={table} labels={LABELS} />
      </div>
      <div className="max-h-[calc(100dvh-260px)] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className={cn(th, h.column.id === "select" && "w-10 pl-4")}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const sel = selected.has(row.original.variantId);
              const Tr = animateRows ? motion.tr : "tr";
              return (
                <Tr key={row.id} {...(animateRows ? { layout: "position" as const, transition: spring.layout } : {})} className={cn("transition-colors duration-100 [&>td]:shadow-[inset_0_-0.5px_0_var(--hairline)]", sel ? "bg-accent-softer" : "hover:bg-surface-2")}>
                  {row.getVisibleCells().map((c) => (
                    <td key={c.id} className={cn(td, c.column.id === "select" && "pl-4")}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </Tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
