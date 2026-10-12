"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";

/** Calm empty state: illustration, one sentence of guidance, one clear next action. */
export function EmptyState({ icon, title, description, action, className, compact }: { icon: ReactNode; title: string; description: string; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.gentle} className={cn("flex flex-col items-center justify-center text-center", compact ? "px-6 py-10" : "px-6 py-20", className)}>
      <div className="relative mb-5">
        <div className="absolute inset-0 -m-3 rounded-[28px] bg-gradient-to-b from-accent-softer to-transparent" aria-hidden />
        <div className="relative flex size-14 items-center justify-center rounded-[18px] bg-surface text-accent shadow-[var(--shadow-md),var(--ring-inset)] [&>svg]:size-6">{icon}</div>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-[380px] text-sm text-ink-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />;
}

export function SectionHeader({ title, description, action, eyebrow }: { title: string; description?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-md font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Animated success check — drawn once, restrained. */
export function SuccessCheck({ size = 44 }: { size?: number }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 44 44" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.popover} aria-hidden>
      <circle cx="22" cy="22" r="22" fill="var(--good)" />
      <motion.path d="M13 22.5l6 6L31 16" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.12, duration: 0.32, ease: [0.22, 1, 0.36, 1] }} />
    </motion.svg>
  );
}
