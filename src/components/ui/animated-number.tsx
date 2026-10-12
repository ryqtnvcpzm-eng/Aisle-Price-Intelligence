"use client";

import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Rolling number for headline figures. Animates only when the value actually
 * changes (never on unchanged refreshes), then briefly highlights. Text is
 * written directly to the DOM each frame — no React re-render per tick.
 */
export function AnimatedNumber({ value, format, className, animateOnMount = false, emphasize = true }: { value: number | null; format: (n: number) => string; className?: string; animateOnMount?: boolean; emphasize?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const mv = useMotionValue(animateOnMount ? 0 : (value ?? 0));
  const prev = useRef<number | null>(animateOnMount ? null : value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (value === null) return;
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    if (reduce || (from === null && !animateOnMount)) {
      mv.set(value);
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    if (from !== null && emphasize) {
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
    }
    const controls = animate(mv, value, { type: "spring", stiffness: 120, damping: 22, restDelta: 0.01 });
    return () => controls.stop();
  }, [value, reduce, mv, format, animateOnMount, emphasize]);

  useEffect(() => mv.on("change", (v) => ref.current && (ref.current.textContent = format(v))), [mv, format]);

  return (
    <span className={cn("num relative inline-block rounded-[6px] transition-[background-color] duration-700", flash && "bg-accent-soft", className)}>
      <span ref={ref}>{value === null ? "—" : format(animateOnMount ? 0 : value)}</span>
    </span>
  );
}
