import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  DEMO_PHASES,
  DEMO_PROJECT,
  DEMO_REVISION_LABEL,
  demoProgress,
  filterDemoTasks,
  groupDemoTasksByPhase,
  type DemoKind,
  type DemoPhaseId,
  type DemoTask,
} from "./landingDemo";
import { Badge, Checkbox, ProgressBar, ProgressRing, SegmentedControl } from "@/design-system";
import { cn } from "@/lib/cn";
import { transitions } from "@/lib/motion";

interface LiveProjectCardProps {
  tasks: DemoTask[];
  kind: DemoKind;
  phaseId: DemoPhaseId | "all";
  onKind: (kind: DemoKind) => void;
  onPhase: (phaseId: DemoPhaseId | "all") => void;
  onToggle: (id: string) => void;
  onReset: () => void;
}

/** Interactive mock of a project — ticking items updates progress in place. */
export function LiveProjectCard({ tasks, kind, phaseId, onKind, onPhase, onToggle, onReset }: LiveProjectCardProps) {
  const reduceMotion = useReducedMotion();
  const overall = demoProgress(tasks);
  const scoped = demoProgress(tasks, kind);
  const visible = filterDemoTasks(tasks, kind, phaseId);
  const groups = phaseId === "all" ? groupDemoTasksByPhase(visible) : [{ phase: DEMO_PHASES.find((p) => p.id === phaseId)!, tasks: visible }];
  const complete = overall.total > 0 && overall.done === overall.total;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgb(16_24_40/0.04),0_24px_48px_-20px_rgb(16_24_40/0.18)]">
      <div className="flex items-center gap-2 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <p className="min-w-0 flex-1 truncate text-center text-[12px] font-medium text-ink-muted">{DEMO_PROJECT.name}</p>
        <span className="w-10" aria-hidden />
      </div>

      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">{DEMO_PROJECT.name}</h3>
            <Badge tone="accent" dot>
              {DEMO_PROJECT.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{DEMO_PROJECT.client}</p>
        </div>
        <ProgressRing value={overall.percent} size={64} strokeWidth={6} label="Project completion">
          <span className="text-[13px] font-semibold tabular text-ink">{overall.percent}%</span>
        </ProgressRing>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-5">
        <SegmentedControl
          layoutId="landing-kind"
          ariaLabel="Preview checklist kind"
          value={kind}
          onChange={onKind}
          options={[
            { value: "scope", label: "Scope", count: demoProgress(tasks, "scope").total },
            { value: "revision", label: "Revision", count: demoProgress(tasks, "revision").total },
          ]}
        />
        <p className="text-xs font-medium tabular text-ink-muted">
          {scoped.done}/{scoped.total} on this list
        </p>
      </div>

      {kind === "revision" && (
        <div className="px-5 pt-3">
          <Badge tone={scoped.percent === 100 ? "success" : "warning"}>{DEMO_REVISION_LABEL}</Badge>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 px-5" role="tablist" aria-label="Filter by phase">
        <PhaseChip active={phaseId === "all"} onClick={() => onPhase("all")}>
          All phases
        </PhaseChip>
        {DEMO_PHASES.map((phase) => (
          <PhaseChip key={phase.id} active={phaseId === phase.id} onClick={() => onPhase(phase.id)}>
            {phase.title}
          </PhaseChip>
        ))}
      </div>

      <div className="mt-3 px-5">
        <ProgressBar value={scoped.percent} size="sm" label={`${kind === "scope" ? "Scope" : "Revision"} completion`} />
      </div>

      <div className="mt-2 min-h-[13.5rem] px-2 pb-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${kind}-${phaseId}`}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={transitions.base}
          >
            {visible.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-ink-muted">Nothing in this phase for this list.</p>
            ) : (
              groups.map((group) => (
                <div key={group.phase.id} className="pt-2">
                  {phaseId === "all" && (
                    <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">{group.phase.title}</p>
                  )}
                  <ul>
                    {group.tasks.map((task) => (
                      <li key={task.id}>
                        <div
                          className={cn(
                            "flex cursor-pointer items-center gap-1 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-muted",
                            task.done && "opacity-70",
                          )}
                          onClick={() => onToggle(task.id)}
                        >
                          <Checkbox checked={task.done} onChange={() => onToggle(task.id)} label={task.title} />
                          <span className={cn("text-sm text-ink", task.done && "text-ink-muted line-through")} aria-hidden>
                            {task.title}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-xs text-ink-muted" role="status">
          {complete ? "Project complete — this is how sign-off looks in the app." : "Tick the remaining items. Progress updates immediately."}
        </p>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </button>
      </div>
    </div>
  );
}

function PhaseChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
        active ? "bg-ink text-ink-inverse" : "bg-surface-muted text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
