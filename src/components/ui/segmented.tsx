"use client";

import { LayoutGroup, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/**
 * Segmented control with a sliding selection pill (shared layoutId). Labels
 * never re-render their geometry, so text stays perfectly stable while the pill moves.
 */
export function Segmented<T extends string>({ value, onChange, options, size = "md", className, ariaLabel }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; size?: "sm" | "md"; className?: string; ariaLabel: string }) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="radiogroup" aria-label={ariaLabel} className={cn("relative inline-flex items-center rounded-[10px] bg-[var(--bg-sunken)] p-[2px] dark:bg-surface-3", className)}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              title={o.title}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                const idx = options.findIndex((x) => x.value === value);
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  onChange(options[(idx + 1) % options.length]!.value);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  onChange(options[(idx - 1 + options.length) % options.length]!.value);
                }
              }}
              tabIndex={active ? 0 : -1}
              className={cn(
                "relative z-0 flex items-center justify-center gap-1 whitespace-nowrap font-medium transition-colors duration-150",
                size === "sm" ? "h-6 rounded-[8px] px-2 text-xs" : "h-7 rounded-[8px] px-3 text-sm",
                active ? "text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {active && <motion.span layoutId="pill" className="absolute inset-0 -z-10 rounded-[8px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_0.5px_rgba(0,0,0,0.04)] dark:bg-[#3a3a3e]" transition={spring.snappy} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
