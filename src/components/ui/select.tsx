"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Select as RS } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface SelectOption {
  value: string;
  label: ReactNode;
  hint?: string;
}

/** Native-feeling select (macOS pop-up button) on Radix for full keyboard + screen-reader support. */
export function Select({ value, onValueChange, options, placeholder, className, ariaLabel, size = "md", id }: { value: string | undefined; onValueChange: (v: string) => void; options: SelectOption[]; placeholder?: string; className?: string; ariaLabel: string; size?: "sm" | "md"; id?: string }) {
  return (
    <RS.Root value={value} onValueChange={onValueChange}>
      <RS.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center justify-between gap-2 rounded-[9px] bg-surface text-left text-ink shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)] outline-none transition-colors hover:bg-surface-2 focus-visible:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)] data-[placeholder]:text-ink-3",
          size === "sm" ? "h-7 px-2.5 text-sm" : "h-8 px-3 text-sm",
          className,
        )}
      >
        <span className="truncate">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon>
          <ChevronsUpDown className="size-3.5 text-ink-3" />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content position="popper" sideOffset={6} collisionPadding={12} className="material z-[75] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[12px] p-1 data-[state=open]:animate-[sel-in_180ms_cubic-bezier(0.22,1,0.36,1)]">
          <style>{`@keyframes sel-in{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){[data-radix-select-viewport]{animation:none}}`}</style>
          <RS.Viewport>
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} className="relative flex h-8 select-none items-center gap-2 rounded-[8px] pl-7 pr-3 text-sm text-ink outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
                <RS.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5" strokeWidth={2.5} />
                </RS.ItemIndicator>
                <RS.ItemText>{o.label}</RS.ItemText>
                {o.hint && <span className="ml-auto pl-4 text-xs opacity-60">{o.hint}</span>}
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
