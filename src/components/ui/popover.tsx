"use client";

import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu as DM, Popover as RP } from "radix-ui";
import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { popIn, spring } from "../motion/tokens";

/**
 * Glass popover anchored to its trigger. Radix owns focus/escape/positioning;
 * Motion owns the spring entrance from the anchor's side.
 */
export function Popover({ trigger, children, align = "start", side = "bottom", className, open: controlled, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; side?: "top" | "bottom" | "left" | "right"; className?: string; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const set = onOpenChange ?? setInner;
  return (
    <RP.Root open={open} onOpenChange={set}>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <AnimatePresence>
        {open && (
          <RP.Portal forceMount>
            <RP.Content forceMount asChild align={align} side={side} sideOffset={6} collisionPadding={12}>
              <motion.div {...popIn} transition={spring.popover} style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }} className={cn("material z-[70] rounded-[14px] p-1.5 outline-none", className)}>
                {children}
              </motion.div>
            </RP.Content>
          </RP.Portal>
        )}
      </AnimatePresence>
    </RP.Root>
  );
}

const MenuCtx = createContext(false);

export function Menu({ trigger, children, align = "end", className }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DM.Root open={open} onOpenChange={setOpen}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <AnimatePresence>
        {open && (
          <DM.Portal forceMount>
            <DM.Content forceMount asChild align={align} sideOffset={6} collisionPadding={12} loop>
              <motion.div {...popIn} transition={spring.popover} style={{ transformOrigin: "var(--radix-dropdown-menu-content-transform-origin)" }} className={cn("material z-[70] min-w-[200px] rounded-[12px] p-1 outline-none", className)}>
                <MenuCtx.Provider value={true}>{children}</MenuCtx.Provider>
              </motion.div>
            </DM.Content>
          </DM.Portal>
        )}
      </AnimatePresence>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, icon, shortcut, destructive, disabled }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; shortcut?: string; destructive?: boolean; disabled?: boolean }) {
  useContext(MenuCtx);
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 select-none items-center gap-2.5 rounded-[8px] px-2 text-sm outline-none transition-colors duration-100 data-[disabled]:opacity-40",
        destructive ? "text-bad data-[highlighted]:bg-bad data-[highlighted]:text-white" : "text-ink data-[highlighted]:bg-accent data-[highlighted]:text-white",
      )}
    >
      {icon && <span className="flex w-4 justify-center opacity-80 [&>svg]:size-[15px]">{icon}</span>}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs opacity-60">{shortcut}</span>}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="mx-2 my-1 h-px bg-[var(--line)]" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-3">{children}</DM.Label>;
}
