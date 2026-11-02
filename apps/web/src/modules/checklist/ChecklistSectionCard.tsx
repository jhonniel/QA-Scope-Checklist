import { useRef } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronRight, ChevronUp, Pencil } from "lucide-react";
import type { ChecklistSection, Task } from "@scope/contracts";
import { routes } from "@/app/routes";
import { sectionProgress } from "@/lib/stats";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { AnimatedNumber, Button, Card, ConfettiBurst, ProgressBar } from "@/design-system";
import { TaskList, type ToggleCheck } from "./TaskList";
import { QuickAddTask } from "./QuickAddTask";

/** Editor controls shown in the section header (hidden for viewers and while filtering). */
export interface SectionActions {
  onEdit: () => void;
  /** Undefined when the section is already first / last. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export interface ChecklistSectionCardProps {
  section: ChecklistSection;
  tasks: Task[];
  onToggleCheck: ToggleCheck;
  onOpen: (task: Task) => void;
  onReorder: (ordered: Task[]) => void;
  onAdd: (title: string) => Promise<void> | void;
  selectedUuid?: string | null;
  /** Whether the task list is currently filtered (hides quick-add, changes empty copy). */
  filtered?: boolean;
  /** Viewer role: no quick-add, ticking or reordering. */
  readOnly?: boolean;
  actions?: SectionActions;
  /**
   * Completion of the whole section regardless of the active filter; drives the
   * confetti when it reaches 100%. Defaults to the displayed progress.
   */
  completionPercent?: number;
}

/** A checklist section with its tasks, progress, and a drill-in link. */
export function ChecklistSectionCard({ section, tasks, onToggleCheck, onOpen, onReorder, onAdd, selectedUuid, filtered, readOnly = false, actions, completionPercent }: ChecklistSectionCardProps) {
  const progress = sectionProgress(tasks);
  const showActions = !!actions && !readOnly && !filtered;

  // Confetti from the section's progress bar when its last task is resolved.
  const progressRef = useRef<HTMLDivElement>(null);
  const celebrate = useCompletionCelebration(completionPercent ?? progress.percent, section.uuid);

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-1 pr-3">
        <Link
          to={routes.section(section.projectUuid, section.uuid)}
          className="group flex min-w-0 flex-1 items-center gap-3 px-5 pt-4 pb-3 transition-colors hover:bg-surface-muted/60"
          aria-label={`Open section ${section.title}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-ink">{section.title}</h3>
              <span className="shrink-0 text-xs tabular text-ink-faint">
                {progress.completed}/{progress.total}
              </span>
            </div>
            {section.description && <p className="mt-0.5 truncate text-xs text-ink-muted">{section.description}</p>}
          </div>
          <AnimatedNumber value={progress.percent} suffix="%" className="hidden text-xs tabular text-ink-muted sm:block" />
          <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
        </Link>
        {showActions && (
          <div className="flex shrink-0 items-center gap-0.5 pt-1" role="group" aria-label={`Section actions for ${section.title}`}>
            <Button variant="ghost" size="icon-sm" onClick={actions.onMoveUp} disabled={!actions.onMoveUp} aria-label="Move section up">
              <ChevronUp className="size-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={actions.onMoveDown} disabled={!actions.onMoveDown} aria-label="Move section down">
              <ChevronDown className="size-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={actions.onEdit} aria-label="Edit section">
              <Pencil className="size-3.5" aria-hidden />
            </Button>
          </div>
        )}
      </div>
      <div ref={progressRef} className="px-5">
        <ProgressBar value={progress.percent} size="sm" label={`${section.title} completion`} />
      </div>
      <ConfettiBurst fire={celebrate} originRef={progressRef} count={70} announcement={`Section "${section.title}" is complete.`} />

      <div className="px-5 pt-3 pb-2">
        {tasks.length === 0 ? (
          <p className="px-3 py-3 text-sm text-ink-faint">{filtered ? "No tasks match." : readOnly ? "No tasks yet." : "No tasks yet. Add the first one below."}</p>
        ) : (
          <TaskList tasks={tasks} onToggleCheck={onToggleCheck} onOpen={onOpen} onReorder={filtered ? undefined : onReorder} selectedUuid={selectedUuid} readOnly={readOnly} />
        )}
        {!filtered && !readOnly && <QuickAddTask onAdd={onAdd} className="-mx-3 mt-1 lg:mx-0 lg:ml-5" />}
      </div>
    </Card>
  );
}
