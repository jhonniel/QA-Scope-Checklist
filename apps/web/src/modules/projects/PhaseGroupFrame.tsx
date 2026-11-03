import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { PhaseTone } from "./phaseTone";

export interface PhaseGroupFrameProps {
  tone: PhaseTone;
  /** Accessible name for the group, usually the phase title. */
  label: string;
  header: ReactNode;
  children: ReactNode;
  compact?: boolean;
}

/** Coloured tray that holds every scope and revision in one phase. */
export function PhaseGroupFrame({ tone, label, header, children, compact }: PhaseGroupFrameProps) {
  return (
    <section aria-label={label} className="overflow-hidden rounded-2xl border-2" style={{ backgroundColor: tone.fill, borderColor: tone.line }}>
      <div className={cn("border-b px-4", compact ? "py-2" : "py-3")} style={{ borderColor: tone.line }}>
        {header}
      </div>
      <div className={cn(compact ? "p-3" : "space-y-3 p-3")}>{children}</div>
    </section>
  );
}
