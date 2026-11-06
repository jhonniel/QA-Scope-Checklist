import { memo, type PointerEvent } from "react";
import { CalendarDays, GripVertical, MessageSquare } from "lucide-react";
import type { Task, TaskCheckSide } from "@scope/contracts";
import { cn } from "@/lib/cn";
import { formatDueDate, isOverdue } from "@/lib/date";
import { isResolved, statusLabel } from "@/lib/taskStatus";
import { Checkbox, MemberAvatar } from "@/design-system";
import { CheckPair } from "./CheckPair";
import { TaskStatusBadge } from "./TaskStatusBadge";

export interface TaskRowProps {
  task: Task;
  onToggleCheck: (task: Task, side: TaskCheckSide) => void;
  /** Omit on the public share page so guests can tick Client without opening the task. */
  onOpen?: (task: Task) => void;
  /** Start a reorder drag from the grip handle. Omit to hide the handle. */
  onDragHandlePointerDown?: (e: PointerEvent<HTMLElement>) => void;
  selected?: boolean;
  /** Checked for a bulk action (separate from the open-task highlight). */
  picked?: boolean;
  onTogglePicked?: (task: Task) => void;
  /** Show the section / project context (used in cross-section lists). */
  context?: string;
  /** Viewer role: checks are visible but not editable, no drag handle. */
  readOnly?: boolean;
  /** Public share: Client stays tappable. */
  allowClientCheck?: boolean;
  className?: string;
}

/**
 * One checklist item, laid out like the scope document row:
 * [Checked by: Dev | Client]  Item description …  [Remarks status]  [bulk pick]
 */
export const TaskRow = memo(function TaskRow({ task, onToggleCheck, onOpen, onDragHandlePointerDown, selected, picked, onTogglePicked, context, readOnly, allowClientCheck, className }: TaskRowProps) {
  const resolved = isResolved(task);
  const overdue = !resolved && isOverdue(task.dueDate);
  const hasMeta = task.dueDate || task.commentCount > 0 || task.priority === "high" || context;
  const openable = !!onOpen;

  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen(task) : undefined}
      onKeyDown={
        openable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(task);
              }
            }
          : undefined
      }
      aria-label={openable ? `${task.title}, ${statusLabel(task.status)}` : undefined}
      className={cn(
        "group relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        openable && "hover:bg-surface-muted focus-visible:bg-surface-muted active:bg-surface-sunken",
        selected && "bg-accent-soft hover:bg-accent-soft",
        picked && !selected && "bg-surface-muted",
        className,
      )}
    >
      {onDragHandlePointerDown && !readOnly && (
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => {
            e.stopPropagation();
            onDragHandlePointerDown(e);
          }}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1/2 -left-5 hidden size-6 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing lg:flex"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}

      <CheckPair task={task} onToggle={(side) => onToggleCheck(task, side)} readOnly={readOnly} allowClientCheck={allowClientCheck} className="pt-0.5" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("min-w-0 flex-1 text-sm leading-5 text-ink transition-colors", resolved && "text-ink-muted")}>{task.title}</p>
          <TaskStatusBadge status={task.status} className="hidden sm:inline-flex" />
        </div>
        {task.description && (
          <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">{task.description}</p>
        )}
        {/* Below `sm` the status chip moves down here, so this line always exists on phones. */}
        <div className={cn("mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted", !hasMeta && "sm:hidden")}>
          <TaskStatusBadge status={task.status} className="sm:hidden" />
          {context && <span className="truncate text-ink-faint">{context}</span>}
          {task.dueDate && (
            <span className={cn("inline-flex items-center gap-1 tabular", overdue && "font-medium text-danger")}>
              <CalendarDays className="size-3.5" aria-hidden />
              {formatDueDate(task.dueDate)}
            </span>
          )}
          {task.priority === "high" && !resolved && <span className="inline-flex items-center gap-1 text-ink">High</span>}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-1 tabular">
              <MessageSquare className="size-3.5" aria-hidden />
              {task.commentCount}
            </span>
          )}
        </div>
      </div>

      {task.assignee && <MemberAvatar user={task.assignee} size="sm" className="mt-0.5" />}

      {onTogglePicked && (
        <Checkbox
          checked={!!picked}
          onChange={() => onTogglePicked(task)}
          label={picked ? `Deselect "${task.title}"` : `Select "${task.title}"`}
          className="-mr-1 mt-0.5"
        />
      )}
    </div>
  );
});
