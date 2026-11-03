import { useEffect, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Transition } from "framer-motion";
import { cn } from "@/lib/cn";
import { easeOutQuint } from "@/lib/motion";
import { progressFillColor } from "@/lib/progressColor";

/**
 * Data visuals animate twice: a slow "fill" when they first appear (so loaded
 * figures sweep into place) and a quick spring afterwards when the value
 * changes (ticking a task). Both collapse to an instant jump under reduced motion.
 * Fill colour follows the same pace so it eases toward the colour for that %.
 */
const FILL_DURATION = 0.9;
const COLOR_FILL_DURATION = 1.35;
const fillTransition = (delay = 0): Transition => ({ duration: FILL_DURATION, ease: easeOutQuint, delay });
const colorFillTransition = (delay = 0): Transition => ({ duration: COLOR_FILL_DURATION, ease: easeOutQuint, delay });
const settleTransition: Transition = { type: "spring", stiffness: 180, damping: 26 };
const colorSettleTransition: Transition = { duration: 0.55, ease: easeOutQuint };
const startColor = progressFillColor(0);

function progressMotion(firstRender: boolean, reduceMotion: boolean | null, delay = 0) {
  if (reduceMotion) return { duration: 0 };
  return firstRender
    ? { width: fillTransition(delay), backgroundColor: colorFillTransition(delay), stroke: colorFillTransition(delay), strokeDashoffset: fillTransition() }
    : { width: settleTransition, backgroundColor: colorSettleTransition, stroke: colorSettleTransition, strokeDashoffset: { type: "spring" as const, stiffness: 120, damping: 24 } };
}

/** True on the first render only; afterwards the component is "settled" and value changes use the quick spring. */
function useIsFirstRender(): boolean {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return first.current;
}

export interface ProgressBarProps {
  value: number; // 0–100
  size?: "sm" | "md";
  className?: string;
  label?: string;
  /** Seconds to wait before the initial fill — use to stagger bars in a list. */
  delay?: number;
}

export function ProgressBar({ value, size = "md", className, label, delay = 0 }: ProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const firstRender = useIsFirstRender();
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Completion"}
      className={cn("w-full overflow-hidden rounded-full bg-surface-sunken", size === "sm" ? "h-1" : "h-1.5", className)}
    >
      <motion.div
        className="h-full rounded-full"
        initial={reduceMotion ? false : { width: "0%", backgroundColor: startColor }}
        animate={{ width: `${clamped}%`, backgroundColor: progressFillColor(clamped) }}
        transition={progressMotion(firstRender, reduceMotion, delay)}
      />
    </div>
  );
}

export interface ProgressRingProps {
  value: number; // 0–100
  size?: number; // px
  strokeWidth?: number;
  className?: string;
  children?: ReactNode;
  label?: string;
}

export function ProgressRing({ value, size = 96, strokeWidth = 7, className, children, label }: ProgressRingProps) {
  const reduceMotion = useReducedMotion();
  const firstRender = useIsFirstRender();
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Completion"}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-surface-sunken)" strokeWidth={strokeWidth} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduceMotion ? false : { strokeDashoffset: circumference, stroke: startColor }}
          animate={{ strokeDashoffset: offset, stroke: progressFillColor(clamped) }}
          transition={progressMotion(firstRender, reduceMotion)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

export interface MeterProps {
  /** 0–100 share of the track to fill. */
  value: number;
  /** CSS colour for the fill; defaults to the accent via `className`. */
  color?: string;
  className?: string;
  trackClassName?: string;
  /** Seconds to wait before the initial fill — stagger rows in a chart with `index * 0.04`. */
  delay?: number;
}

/**
 * Decorative horizontal bar for charts and rankings (relative shares, not
 * completion). Hidden from assistive tech — the row's text carries the value.
 */
export function Meter({ value, color, className, trackClassName, delay = 0 }: MeterProps) {
  const reduceMotion = useReducedMotion();
  const firstRender = useIsFirstRender();
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken", trackClassName)} aria-hidden>
      <motion.span
        className={cn("block h-full rounded-full", !color && "bg-accent", className)}
        style={color ? { backgroundColor: color } : undefined}
        initial={reduceMotion ? false : { width: "0%" }}
        animate={{ width: `${clamped}%` }}
        transition={reduceMotion ? { duration: 0 } : firstRender ? fillTransition(delay) : settleTransition}
      />
    </span>
  );
}

export interface AnimatedNumberProps {
  value: number;
  /** Text appended after the number, e.g. "%". */
  suffix?: string;
  className?: string;
  /** Seconds to wait before counting up. */
  delay?: number;
  /** Formats the rounded intermediate value; defaults to locale formatting. */
  format?: (n: number) => string;
}

const defaultFormat = (n: number) => n.toLocaleString();

/**
 * Counts up to `value` when it first appears and glides to new values
 * afterwards. Assistive tech reads the final figure only.
 */
export function AnimatedNumber({ value, suffix = "", className, delay = 0, format = defaultFormat }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const firstRender = useIsFirstRender();
  const motionValue = useMotionValue(reduceMotion ? value : 0);
  const text = useTransform(motionValue, (v) => format(Math.round(v)) + suffix);

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, firstRender ? { duration: FILL_DURATION, ease: easeOutQuint, delay } : { duration: 0.4, ease: easeOutQuint });
    return () => controls.stop();
    // `firstRender` is deliberately not a dependency: it only decides the pace of the run started by this value change.
  }, [value, reduceMotion, delay, motionValue]);

  const final = format(value) + suffix;
  if (reduceMotion) return <span className={className}>{final}</span>;
  return (
    <span className={className}>
      <motion.span aria-hidden>{text}</motion.span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
