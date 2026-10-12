"use client";

import { motion } from "motion/react";
import { Switch as RSwitch } from "radix-ui";
import { cn } from "@/lib/cn";
import { spring } from "../motion/tokens";

/** Spring-driven toggle. The thumb travels on a spring; the track crossfades color. */
export function Switch({ checked, onCheckedChange, label, disabled, size = "md", id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; size?: "sm" | "md"; id?: string }) {
  const w = size === "sm" ? 32 : 40;
  const h = size === "sm" ? 20 : 24;
  const t = h - 4;
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn("relative inline-flex shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 disabled:opacity-50", checked ? "bg-[var(--good)]" : "bg-[var(--line-strong)] dark:bg-[#39393d]")}
      style={{ width: w, height: h }}
    >
      <RSwitch.Thumb asChild>
        <motion.span
          className="block rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)]"
          style={{ width: t, height: t }}
          animate={{ x: checked ? w - t - 4 : 0 }}
          whileTap={{ scaleX: 1.15 }}
          transition={spring.snappy}
        />
      </RSwitch.Thumb>
    </RSwitch.Root>
  );
}
