import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  ariaLabel: string;
  className?: string;
  /** Unique id so the sliding indicator does not collide between controls. */
  layoutId: string;
}

export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel, className, layoutId }: SegmentedControlProps<T>) {
  const reduceMotion = useReducedMotion();
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex h-full items-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-200",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md bg-surface shadow-float"
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
                aria-hidden
              />
            )}
            <span className="relative">{opt.label}</span>
            {opt.count !== undefined && <span className={cn("relative tabular text-xs", active ? "text-ink-muted" : "text-ink-faint")}>{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
