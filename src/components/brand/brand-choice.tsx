"use client";

import { motion } from "motion/react";
import { Check, Plus } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { spring, staggerDelay } from "../motion/tokens";

export interface BrandOption {
  id: string;
  name: string;
  listings: number;
  isReference: boolean;
}

export type BrandChoice = { kind: "existing"; id: string; name: string } | { kind: "new"; name: string } | null;

/**
 * "Which brand is yours?" — a radio list of the workspace's brands plus a
 * free-text option for a brand that hasn't been imported yet. Shared by
 * onboarding and the change-brand dialog so both read the same way.
 */
export function BrandChoiceList({ brands, value, onChange, newName, onNewName, compact }: { brands: BrandOption[]; value: BrandChoice; onChange: (c: BrandChoice) => void; newName: string; onNewName: (s: string) => void; compact?: boolean }) {
  const group = useId();
  const isNew = value?.kind === "new";
  return (
    <div role="radiogroup" aria-label="Your brand" className="space-y-1.5">
      {brands.map((b, i) => {
        const on = value?.kind === "existing" && value.id === b.id;
        return (
          <motion.button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={on}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.gentle, delay: staggerDelay(i) }}
            whileTap={{ scale: 0.985 }}
            onClick={() => onChange({ kind: "existing", id: b.id, name: b.name })}
            className={cn(
              "flex w-full items-center gap-3 rounded-[12px] text-left transition-shadow",
              compact ? "px-3 py-2.5" : "px-3.5 py-3",
              on ? "bg-surface shadow-[0_0_0_2px_var(--accent),var(--shadow-sm)]" : "bg-surface shadow-[var(--shadow-xs),var(--ring-inset)] hover:shadow-[var(--shadow-sm),var(--ring-inset)]",
            )}
          >
            <Radio on={on} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{b.name}</span>
              <span className="block text-xs text-ink-3">
                {b.listings} tracked listing{b.listings === 1 ? "" : "s"}
                {b.isReference ? " · your brand now" : ""}
              </span>
            </span>
          </motion.button>
        );
      })}
      <div className={cn("flex items-center gap-3 rounded-[12px] bg-surface transition-shadow", compact ? "px-3 py-2" : "px-3.5 py-2.5", isNew ? "shadow-[0_0_0_2px_var(--accent),var(--shadow-sm)]" : "shadow-[var(--shadow-xs),var(--ring-inset)]")}>
        <button type="button" role="radio" aria-checked={isNew} aria-labelledby={`${group}-new`} onClick={() => onChange(newName.trim() ? { kind: "new", name: newName.trim() } : { kind: "new", name: "" })} className="shrink-0">
          {isNew ? <Radio on /> : <span className="flex size-5 items-center justify-center rounded-full text-ink-3 shadow-[inset_0_0_0_1.5px_var(--line-strong)]"><Plus className="size-3" strokeWidth={2.6} /></span>}
        </button>
        <input
          id={`${group}-new`}
          value={newName}
          onFocus={() => onChange({ kind: "new", name: newName.trim() })}
          onChange={(e) => {
            onNewName(e.target.value);
            onChange({ kind: "new", name: e.target.value.trim() });
          }}
          placeholder={brands.length ? "Another brand…" : "Your brand's name"}
          aria-label="Another brand"
          maxLength={80}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-ink-4"
        />
      </div>
    </div>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full transition-colors", on ? "bg-accent text-white" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)]")} aria-hidden>
      {on && (
        <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring.snappy}>
          <Check className="size-3" strokeWidth={3} />
        </motion.span>
      )}
    </span>
  );
}

/** Request body for /api/brands/reference from a choice. */
export function choiceBody(c: BrandChoice) {
  if (!c) return null;
  return c.kind === "existing" ? { brandId: c.id } : c.name ? { brandName: c.name } : null;
}
