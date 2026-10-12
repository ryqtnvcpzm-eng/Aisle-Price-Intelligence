import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const badgeStyles = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium", {
  variants: {
    tone: {
      neutral: "bg-[var(--hairline)] text-ink-2 dark:bg-surface-3",
      accent: "bg-accent-soft text-accent",
      good: "bg-good-soft text-good",
      warn: "bg-warn-soft text-warn",
      bad: "bg-bad-soft text-bad",
      down: "bg-down-soft text-down",
      up: "bg-up-soft text-up",
      sim: "bg-sim-soft text-sim",
      outline: "text-ink-2 shadow-[inset_0_0_0_0.5px_var(--line-strong)]",
    },
    size: { xs: "h-[18px] px-1.5 text-2xs", sm: "h-5 px-2 text-xs", md: "h-6 px-2.5 text-xs" },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export function Badge({ className, tone, size, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone, size }), className)} {...props} />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-sans text-2xs font-medium text-ink-3 shadow-[inset_0_0_0_0.5px_var(--line-strong),0_1px_0_var(--line)]", className)}>{children}</kbd>;
}
