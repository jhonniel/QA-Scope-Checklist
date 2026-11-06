import { useState } from "react";
import { TASK_STATUSES, TASK_STATUS_LABELS, type Task, type TaskStatus } from "@scope/contracts";
import { Checkbox, ConfirmDialog, Select } from "@/design-system";
import { TASK_STATUS_META } from "@/lib/taskStatus";

export interface BulkStatusControlProps {
  selectedTasks: Task[];
  visibleCount: number;
  allSelected: boolean;
  onToggleAll: () => void;
  /** Lowercase "scope" or "revision". */
  noun: string;
  onApply: (status: TaskStatus, taskUuids: string[]) => Promise<void> | void;
}

/** Pick tasks, then apply one remarks status to that selection. */
export function BulkStatusControl({ selectedTasks, visibleCount, allSelected, onToggleAll, noun, onApply }: BulkStatusControlProps) {
  const [pending, setPending] = useState<TaskStatus | null>(null);
  const count = selectedTasks.length;
  const label = pending ? TASK_STATUS_META[pending].label : "";
  const description =
    count === 1 ? `Set this task to ${label}?` : `Set ${count} selected tasks to ${label}?`;

  if (visibleCount === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select
          aria-label={`Set status of selected ${noun} tasks`}
          value=""
          disabled={count === 0}
          onChange={(e) => {
            const next = e.target.value as TaskStatus;
            if (!next || count === 0) return;
            setPending(next);
          }}
          wrapperClassName="w-full sm:w-56"
        >
          <option value="" disabled>
            Set status…
          </option>
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex min-w-0 items-center">
          <span className="text-xs text-ink-muted tabular">{count === 0 ? "Select tasks" : `${count} selected`}</span>
          <Checkbox checked={allSelected} onChange={onToggleAll} label={`Select all ${noun} tasks`} className="-mr-1" />
        </div>
      </div>
      <ConfirmDialog
        open={pending !== null && count > 0}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          if (!pending || count === 0) return;
          await onApply(
            pending,
            selectedTasks.map((t) => t.uuid),
          );
        }}
        title={count === 1 ? "Change status?" : "Change statuses?"}
        description={description}
        confirmLabel="Set status"
      />
    </>
  );
}
