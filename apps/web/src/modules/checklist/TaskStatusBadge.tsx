import type { TaskStatus } from "@scope/contracts";
import { cn } from "@/lib/cn";
import { TASK_STATUS_META } from "@/lib/taskStatus";

export interface TaskStatusBadgeProps {
  status: TaskStatus;
  /** `dot` renders only the coloured dot (tight spaces); `chip` adds the label. */
  variant?: "chip" | "dot";
  /** Allow the label to wrap onto multiple lines (narrow document cells). */
  wrap?: boolean;
  className?: string;
}

/** The "Remarks" status, rendered as a coloured dot + label chip. */
export function TaskStatusBadge({ status, variant = "chip", wrap = false, className }: TaskStatusBadgeProps) {
  const meta = TASK_STATUS_META[status];
  if (variant === "dot") {
    return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: meta.color }} role="img" aria-label={meta.label} title={meta.label} />;
  }
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium", wrap ? "items-start rounded-lg" : "whitespace-nowrap", meta.chip, className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", wrap && "mt-[5px]")} style={{ backgroundColor: meta.color }} aria-hidden />
      <span className={wrap ? "min-w-0" : "truncate"}>{meta.label}</span>
    </span>
  );
}
