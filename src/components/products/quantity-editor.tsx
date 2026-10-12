"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatQuantity } from "@/lib/quantity";
import type { QuantityRow } from "@/server/catalog/queries";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";
import { Select } from "../ui/select";

const UNITS: Record<string, string[]> = { mass: ["g", "kg", "mg", "oz", "lb"], volume: ["ml", "l", "fl oz"], count: ["tablet", "capsule", "softgel", "gummy", "sachet", "item", "bar", "pod"], serving: ["serving"] };

/**
 * Inline quantity correction. Parsed values are shown as unverified with their
 * source text; saving makes them "manual" (trusted) without discarding the original text.
 */
export function QuantityEditor({ variantId, quantities, label }: { variantId: string; quantities: QuantityRow[]; label: string }) {
  const router = useRouter();
  const q = quantities[0];
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState<string>(q?.dimension ?? "mass");
  const [packCount, setPackCount] = useState(String(q?.packCount ?? 1));
  const [amount, setAmount] = useState(String(q?.unitAmount ?? ""));
  const [unit, setUnit] = useState(q?.unit && UNITS[q.dimension]?.includes(q.unit) ? q.unit : (UNITS[q?.dimension ?? "mass"]![0] as string));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/api/variants/${variantId}/quantity`, { method: "PUT", body: { dimension, packCount: Number(packCount), unitAmount: Number(amount), unit } });
      toast.success("Quantity saved — unit prices updated");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-[300px] p-3"
      trigger={
        <button className={cn("group inline-flex items-center gap-1 rounded-[6px] px-1 py-0.5 -mx-1 text-left text-xs outline-none transition-colors hover:bg-[var(--hairline)] focus-visible:bg-[var(--hairline)]", q ? "text-ink-2" : "font-medium text-warn")} aria-label={`Edit quantity for ${label}`}>
          {q ? formatQuantity(q) : "Add quantity"}
          {q?.confidence === "manual" && <span className="text-good" title="Corrected manually">✓</span>}
          <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
        </button>
      }
    >
      <div className="space-y-3 p-1">
        <div>
          <div className="text-sm font-semibold">Pack quantity</div>
          {q ? (
            <p className="mt-0.5 text-xs text-ink-3">
              <Badge tone={q.confidence === "manual" ? "good" : "warn"} size="xs" className="mr-1">{q.confidence === "manual" ? "Verified by you" : "Parsed — unverified"}</Badge>
              from “{q.matchedText ?? q.sourceText}”
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-3">The provider didn't state a quantity Aisle could parse.</p>
          )}
        </div>
        <Select ariaLabel="Measure" className="w-full" value={dimension} onValueChange={(d) => { setDimension(d); setUnit(UNITS[d]![0]!); }} options={[{ value: "mass", label: "Weight" }, { value: "volume", label: "Volume" }, { value: "count", label: "Count (tablets, items…)" }, { value: "serving", label: "Servings" }]} />
        <div className="flex items-center gap-2">
          <input aria-label="Pack count" inputMode="numeric" value={packCount} onChange={(e) => setPackCount(e.target.value.replace(/[^\d]/g, ""))} className="num h-8 w-12 rounded-[8px] bg-surface px-2 text-center text-sm shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
          <span className="text-sm text-ink-3">×</span>
          <input aria-label="Amount per pack" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="500" className="num h-8 w-20 rounded-[8px] bg-surface px-2 text-sm shadow-[inset_0_0_0_0.5px_var(--line-strong)]" />
          <Select ariaLabel="Unit" size="sm" className="flex-1" value={unit} onValueChange={setUnit} options={UNITS[dimension]!.map((u) => ({ value: u, label: u }))} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!Number(amount) || !Number(packCount)} onClick={save}>Save</Button>
        </div>
      </div>
    </Popover>
  );
}
