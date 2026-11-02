import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion presets. Keep them short and purposeful — the checklist must
 * never feel slowed down by animation.
 */

export const easeOutQuint = [0.22, 1, 0.36, 1] as const;

export const transitions = {
  fast: { duration: 0.15, ease: easeOutQuint } satisfies Transition,
  base: { duration: 0.24, ease: easeOutQuint } satisfies Transition,
  slow: { duration: 0.36, ease: easeOutQuint } satisfies Transition,
  /** Spring tuned for sheets: quick settle, no visible bounce. */
  sheet: { type: "spring", stiffness: 420, damping: 42, mass: 0.9 } satisfies Transition,
  /** Spring tuned for list reordering / layout changes. */
  layout: { type: "spring", stiffness: 500, damping: 40 } satisfies Transition,
} as const;

/** Fade + lift in, used for cards and list items appearing. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.base },
  exit: { opacity: 0, y: 4, transition: transitions.fast },
};

/** Container that staggers `riseIn` children. */
export const staggerChildren = (stagger = 0.035): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: 0.02 } },
});

/**
 * "Slide to drill in": horizontal page transition. `direction` is 1 when
 * navigating deeper, -1 when navigating back, 0 for lateral moves.
 */
export const slideVariants: Variants = {
  initial: (direction: number) => ({
    x: direction === 0 ? 0 : direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  animate: { x: 0, opacity: 1, transition: transitions.slow },
  exit: (direction: number) => ({
    x: direction === 0 ? 0 : direction > 0 ? -24 : 24,
    opacity: 0,
    transition: transitions.fast,
  }),
};

/** Reduced-motion fallback: fade only, no translation. */
export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};
