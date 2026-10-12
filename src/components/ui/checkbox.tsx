"use client";

import { motion } from "motion/react";
import { Checkbox as RC } from "radix-ui";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";

/** Checkbox with a drawn checkmark; supports indeterminate for bulk selection. */
export function Checkbox({ checked, onCheckedChange, label, className, size = 16 }: { checked: boolean | "indeterminate"; onCheckedChange: (v: boolean) => void; label: string; className?: string; size?: number }) {
  const on = checked === true || checked === "indeterminate";
  return (
    <RC.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-[5px] transition-colors duration-150", on ? "bg-accent" : "bg-surface shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink-4)]", className)}
      style={{ width: size, height: size }}
    >
      <motion.svg viewBox="0 0 16 16" className="absolute inset-0 text-white" initial={false} animate={{ scale: on ? 1 : 0.6, opacity: on ? 1 : 0 }} transition={spring.snappy}>
        {checked === "indeterminate" ? (
          <path d="M4.5 8h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <motion.path d="M4 8.4l2.6 2.6L12 5.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" initial={false} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.18 }} />
        )}
      </motion.svg>
    </RC.Root>
  );
}
