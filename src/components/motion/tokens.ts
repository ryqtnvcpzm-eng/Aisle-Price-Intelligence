/**
 * Motion tokens — the single source for every duration, spring and stagger in
 * Aisle. Components import roles ("press", "popover", "panel"), never raw numbers.
 * Values follow docs/MOTION_SPEC.md and were tuned by eye at 60/120Hz.
 */
import type { Transition } from "motion/react";

export const duration = {
  micro: 0.12,
  press: 0.16,
  control: 0.22,
  popover: 0.24,
  page: 0.3,
  panel: 0.38,
  spatial: 0.46,
} as const;

export const ease = {
  /** Decelerating, for things arriving. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Symmetric, for state changes in place. */
  standard: [0.25, 0.1, 0.25, 1] as const,
  /** Accelerating, for things leaving. */
  in: [0.4, 0, 1, 1] as const,
};

/**
 * Opacity never rides a spring: a spring lets it crawl (a dialog stays
 * see-through for ~300 ms and the page ghosts through it). Every spring below
 * moves geometry physically while opacity resolves with this short tween.
 * Motion inherits the parent `delay` into per-value transitions, so staggers
 * still apply to the fade.
 */
const fade = { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

/** Springs: stiffness/damping/mass. Critically-damped-ish unless noted. */
export const spring = {
  /** Toggles, segmented pills, tab indicators — crisp, no overshoot. */
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8, opacity: fade },
  /** Buttons and tactile press feedback. */
  press: { type: "spring", stiffness: 700, damping: 34, mass: 0.6, opacity: fade },
  /** Menus, popovers, palettes — quick with a whisper of settle. */
  popover: { type: "spring", stiffness: 440, damping: 32, mass: 0.9, opacity: { ...fade, duration: 0.14 } },
  /** Sheets, drawers, dialogs. */
  panel: { type: "spring", stiffness: 300, damping: 32, mass: 1, opacity: fade },
  /** Shared-element / layout moves (cards → detail, reorders). */
  layout: { type: "spring", stiffness: 340, damping: 34, mass: 1, opacity: fade },
  /** Gentle — numbers, list settling. */
  gentle: { type: "spring", stiffness: 180, damping: 26, mass: 1, opacity: { ...fade, duration: 0.24 } },
} as const satisfies Record<string, Transition>;

/** A plain fade for content swaps in place. */
export const fadeTween = fade;

export const stagger = {
  list: 0.035,
  grid: 0.04,
  variants: 0.045,
  max: 0.32, // never delay the last item more than this
} as const;

export function staggerDelay(index: number, step: number = stagger.list) {
  return Math.min(index * step, stagger.max);
}

/** Standard enter/exit for content that appears in place. */
export const fadeRise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
} as const;

export const popIn = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: duration.micro, ease: ease.in } },
} as const;
