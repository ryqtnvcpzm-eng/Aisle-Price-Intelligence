"use client";

import type { Column, Table } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Check, Columns3 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Menu, MenuItem, MenuLabel } from "./popover";
import { Tooltip } from "./tooltip";

/** Sortable header cell content: label + quiet direction glyph; numeric columns right-align. */
export function SortHeader<T>({ column, label, align = "left", hint }: { column: Column<T, unknown>; label: string; align?: "left" | "right"; hint?: string }) {
  const dir = column.getIsSorted();
  const btn = (
    <button
      onClick={column.getToggleSortingHandler()}
      className={cn("group inline-flex items-center gap-1 whitespace-nowrap rounded-[5px] outline-none transition-colors hover:text-ink focus-visible:text-ink", align === "right" && "flex-row-reverse", dir && "text-ink")}
      aria-label={`Sort by ${label}`}
    >
      <span className={cn(hint && "underline decoration-dotted decoration-ink-4 underline-offset-[3px]")}>{label}</span>
      <span className={cn("transition-opacity", dir ? "opacity-100" : "opacity-0 group-hover:opacity-40")}>{dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}</span>
    </button>
  );
  return <div className={cn("flex", align === "right" && "justify-end")}>{hint ? <Tooltip content={hint}>{btn}</Tooltip> : btn}</div>;
}

export function ColumnsMenu<T>({ table, labels }: { table: Table<T>; labels: Record<string, string> }) {
  return (
    <Menu
      align="end"
      trigger={
        <Button variant="ghost" size="sm" aria-label="Choose columns">
          <Columns3 className="size-3.5" /> Columns
        </Button>
      }
    >
      <MenuLabel>Visible columns</MenuLabel>
      {table
        .getAllLeafColumns()
        .filter((c) => c.getCanHide())
        .map((c) => (
          <MenuItem key={c.id} icon={c.getIsVisible() ? <Check /> : <span />} onSelect={() => c.toggleVisibility()}>
            {labels[c.id] ?? c.id}
          </MenuItem>
        ))}
    </Menu>
  );
}

export const th = "sticky top-0 z-10 bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-wide text-ink-3 backdrop-blur-md shadow-[inset_0_-0.5px_0_var(--line)]";
export const td = "px-3 py-2.5 align-middle";
