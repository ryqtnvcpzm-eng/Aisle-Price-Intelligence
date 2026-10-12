"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import Link from "next/link";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { duration, spring } from "../motion/tokens";
import { Spinner } from "./spinner";

export const buttonStyles = cva(
  "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink shadow-[0_1px_1px_rgba(0,0,0,0.08),inset_0_0.5px_0_rgba(255,255,255,0.25)] hover:bg-accent-hover",
        secondary: "bg-surface text-ink shadow-[var(--shadow-xs),inset_0_0_0_0.5px_var(--line-strong)] hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-[var(--hairline)] hover:text-ink",
        tinted: "bg-accent-soft text-accent hover:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)]",
        destructive: "bg-bad text-white hover:opacity-90",
        plain: "text-accent hover:text-accent-hover",
      },
      size: {
        xs: "h-6 rounded-[7px] px-2 text-xs",
        sm: "h-7 rounded-[8px] px-2.5 text-sm",
        md: "h-8 rounded-[9px] px-3 text-sm",
        lg: "h-10 rounded-[11px] px-4 text-md",
        icon: "h-8 w-8 rounded-[9px]",
        "icon-sm": "h-7 w-7 rounded-[8px]",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type Props = Omit<HTMLMotionProps<"button">, "children"> &
  VariantProps<typeof buttonStyles> & { loading?: boolean; children?: React.ReactNode };

/** Tactile button: spring press, crossfaded loading state, never blocks on animation. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={spring.press}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {loading ? (
          <motion.span key="spin" className="absolute inset-0 flex items-center justify-center" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.micro }}>
            <Spinner size={14} />
          </motion.span>
        ) : null}
      </AnimatePresence>
      <span className={cn("inline-flex items-center gap-1.5 transition-opacity duration-150", loading && "opacity-0")}>{children}</span>
    </motion.button>
  );
});

export function ButtonLink({ className, variant, size, ...props }: ComponentProps<typeof Link> & VariantProps<typeof buttonStyles>) {
  return <Link className={cn(buttonStyles({ variant, size }), "active:scale-[0.97] transition-transform", className)} {...props} />;
}
