"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PriceHistory } from "../charts/price-history";
import { Select } from "../ui/select";

interface Opt {
  variantId: string;
  name: string;
  brandName: string | null;
  isReference: boolean;
  marketplace: string;
  currency: string | null;
}

/** Cross-portfolio history: pick a comparison group as a preset or compose any set of listings. */
export function HistoryExplorer({ options, groups, initial }: { options: Opt[]; groups: { id: string; name: string }[]; initial?: string[] }) {
  const [preset, setPreset] = useState<string>(groups[0]?.id ?? "reference");
  const { data } = useQuery({
    queryKey: ["group-items", preset],
    queryFn: () => api<{ items: { variantId: string; status: string }[] }>(`/api/groups/${preset}`),
    enabled: !initial && preset !== "reference" && preset !== "custom",
  });
  const selected = useMemo(() => {
    if (initial?.length) return initial;
    if (preset === "reference") return options.filter((o) => o.isReference).slice(0, 10).map((o) => o.variantId);
    return data?.items.filter((i) => i.status === "confirmed").map((i) => i.variantId) ?? null;
  }, [initial, preset, data, options]);

  return (
    <div className="space-y-4">
      {!initial && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-2">Start from</span>
          <Select ariaLabel="Preset" size="sm" value={preset} onValueChange={setPreset} options={[...groups.map((g) => ({ value: g.id, label: g.name })), { value: "reference", label: "Reference brand listings" }]} />
        </div>
      )}
      <div className="card p-5">
        {selected ? <PriceHistory key={selected.join(",")} options={options} initialSelected={selected} colorBy="brand" defaultRange="90d" height={400} /> : <div className="skeleton h-[400px]" />}
      </div>
    </div>
  );
}
