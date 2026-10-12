"use client";

import { Tooltip as RT } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={350} skipDelayDuration={200}>{children}</RT.Provider>;
}

/** Tooltip: keyboard- and touch-accessible via Radix; gentle fade/scale from its anchor. */
export function Tooltip({ content, children, side = "top", className, asChild = true }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left"; className?: string; asChild?: boolean }) {
  if (!content) return <>{children}</>;
  return (
    <RT.Root>
      <RT.Trigger asChild={asChild}>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-[80] max-w-[280px] rounded-[8px] bg-[#1d1d1f] px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg dark:bg-[#3a3a3e]",
            "origin-[var(--radix-tooltip-content-transform-origin)] data-[state=delayed-open]:animate-[tip-in_160ms_cubic-bezier(0.22,1,0.36,1)] data-[state=instant-open]:animate-[tip-in_100ms_ease-out]",
            className,
          )}
        >
          {content}
          <style>{`@keyframes tip-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion: reduce){[data-radix-popper-content-wrapper] *{animation:none!important}}`}</style>
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
