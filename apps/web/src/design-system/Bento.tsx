import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";
import { riseIn, staggerChildren } from "@/lib/motion";

/**
 * Responsive bento grid: 2 columns on phones (cards span both by default),
 * 2 on tablets, 4 on desktop. Children declare their span with `BentoCard`.
 */
export function BentoGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div variants={staggerChildren(0.04)} initial="hidden" animate="visible" className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:auto-rows-[minmax(10rem,auto)]", className)}>
      {children}
    </motion.div>
  );
}

type Span = 1 | 2 | 3 | 4;

export interface BentoCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Column span at `lg` and above (grid has 4 columns). */
  cols?: Span;
  /** Row span at `lg` and above. */
  rows?: 1 | 2;
  /** Column span below `lg` (grid has 2 columns). Defaults to 2 (full width); use 1 for compact stat tiles. */
  smCols?: 1 | 2;
  label?: ReactNode;
  action?: ReactNode;
  tinted?: boolean;
  flush?: boolean;
}

const colClass: Record<Span, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };
const rowClass = { 1: "lg:row-span-1", 2: "lg:row-span-2" } as const;
const smColClass = { 1: "col-span-1", 2: "col-span-2" } as const;

export const BentoCard = forwardRef<HTMLDivElement, BentoCardProps>(function BentoCard(
  { cols = 1, rows = 1, smCols = 2, label, action, tinted, flush, className, children, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      variants={riseIn}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line",
        tinted ? "bg-surface-muted" : "bg-surface",
        !flush && "p-5",
        colClass[cols],
        rowClass[rows],
        smColClass[smCols],
        className,
      )}
      {...(rest as object)}
    >
      {(label || action) && (
        <div className={cn("mb-3 flex items-center justify-between gap-2", flush && "px-5 pt-5")}>
          {label && <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>}
          {action}
        </div>
      )}
      {children}
    </motion.div>
  );
});
