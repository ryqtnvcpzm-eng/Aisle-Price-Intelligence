"use client";

import { LayoutGroup, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";

/** Underline tabs with a gliding indicator. Content crossfade is the caller's AnimatePresence. */
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="tablist" className={cn("no-scrollbar flex items-center gap-1 overflow-x-auto hairline-b [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] sm:[mask-image:none]", className)}>
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.value === value);
                if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length]!.value);
                if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.value);
              }}
              className={cn("relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-sm font-medium transition-colors", active ? "text-ink" : "text-ink-3 hover:text-ink-2")}
            >
              {t.label}
              {t.count !== undefined && <span className="num rounded-full bg-[var(--hairline)] px-1.5 text-2xs text-ink-3">{t.count}</span>}
              {active && <motion.span layoutId="tab-underline" className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-ink" transition={spring.snappy} />}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
