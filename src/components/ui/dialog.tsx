"use client";

import { AnimatePresence, motion } from "motion/react";
import { Dialog as RD } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { duration, ease, spring } from "../motion/tokens";

/**
 * Modal surface. Radix handles focus trapping, escape, scroll lock and
 * aria; Motion springs it in from slightly below with a soft scrim.
 * On small screens it becomes a bottom sheet with safe-area padding.
 */
export function Dialog({ open, onOpenChange, title, description, children, className, hideTitle, size = "md", initialFocus }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; className?: string; hideTitle?: boolean; size?: "sm" | "md" | "lg" | "xl"; initialFocus?: string }) {
  const widths = { sm: "sm:max-w-[420px]", md: "sm:max-w-[560px]", lg: "sm:max-w-[720px]", xl: "sm:max-w-[880px]" };
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.page, ease: ease.standard }} />
            </RD.Overlay>
            <RD.Content
              asChild
              forceMount
              aria-describedby={description ? undefined : undefined}
              onOpenAutoFocus={(e) => {
                if (!initialFocus) return;
                e.preventDefault();
                (document.querySelector(initialFocus) as HTMLElement | null)?.focus();
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.985, transition: { duration: duration.control, ease: ease.in } }}
                transition={spring.panel}
                className={cn(
                  "fixed inset-x-0 bottom-0 z-[61] flex max-h-[92dvh] flex-col overflow-hidden rounded-t-[22px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-pop)] outline-none",
                  "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[9vh] sm:max-h-[82vh] sm:w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:rounded-[20px] sm:pb-0",
                  widths[size],
                  className,
                )}
              >
                <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--line-strong)] sm:hidden" aria-hidden />
                <RD.Title className={cn(hideTitle ? "sr-only" : "px-6 pt-5 text-lg font-semibold tracking-tight")}>{title}</RD.Title>
                {description ? <RD.Description className={cn(hideTitle ? "sr-only" : "px-6 pt-1 text-sm text-ink-2")}>{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
                {children}
              </motion.div>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}

/** Side sheet for detail drawers (right on desktop, bottom on mobile). */
export function Sheet({ open, onOpenChange, title, children, className }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; children: ReactNode; className?: string }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RD.Portal forceMount>
            <RD.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.page }} />
            </RD.Overlay>
            <RD.Content asChild forceMount>
              <motion.aside
                initial={{ x: "100%", opacity: 0.6 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.6, transition: { duration: duration.control, ease: ease.in } }}
                transition={spring.panel}
                className={cn("fixed inset-y-2 right-2 z-[61] flex w-[min(460px,calc(100vw-16px))] flex-col overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-pop)] outline-none", className)}
              >
                <RD.Title className="sr-only">{title}</RD.Title>
                <RD.Description className="sr-only">{title}</RD.Description>
                {children}
              </motion.aside>
            </RD.Content>
          </RD.Portal>
        )}
      </AnimatePresence>
    </RD.Root>
  );
}

export const DialogClose = RD.Close;
