import { RESOLVED_TASK_STATUSES, TASK_STATUS_LABELS, type Task, type TaskCheckSide, type TaskStatus } from "@scope/contracts";

export interface TaskStatusMeta {
  label: string;
  /** Dot colour. Statuses are the one place data colour is allowed; keep them muted. */
  color: string;
  /** Chip background/text pairing used in rows and the export preview. */
  chip: string;
}

const L = TASK_STATUS_LABELS;

/** Labels come from the shared contract so the DOCX "Remarks" column and the UI always agree. */
export const TASK_STATUS_META: Record<TaskStatus, TaskStatusMeta> = {
  not_started: { label: L.not_started, color: "#2a4fd6", chip: "bg-[#e9eefb] text-[#1f3ea8]" },
  in_development: { label: L.in_development, color: "#e8c75a", chip: "bg-[#fbf3d4] text-[#7a5f0b]" },
  for_qa: { label: L.for_qa, color: "#f08c2e", chip: "bg-[#fdebd9] text-[#8a4a0f]" },
  for_revision: { label: L.for_revision, color: "#6b3a1e", chip: "bg-[#f1e4dd] text-[#5a2f16]" },
  done_for_production: { label: L.done_for_production, color: "#2e9d4a", chip: "bg-[#e3f4e7] text-[#1f6f33]" },
  for_user_acceptance: { label: L.for_user_acceptance, color: "#c9b6e4", chip: "bg-[#f1ecf9] text-[#5c4487]" },
  done: { label: L.done, color: "#34a853", chip: "bg-[#e3f4e7] text-[#1f6f33]" },
  for_beta_testing: { label: L.for_beta_testing, color: "#c7c9d1", chip: "bg-[#eeeff2] text-[#4f5160]" },
  completed: { label: L.completed, color: "#0f6b3f", chip: "bg-[#dcefe5] text-[#0b4f2e]" },
  on_hold: { label: L.on_hold, color: "#3c3c43", chip: "bg-[#e6e6ea] text-[#2a2a30]" },
  not_applicable: { label: L.not_applicable, color: "#8a8a93", chip: "bg-[#ededf0] text-[#5b5b64]" },
};

export const CHECK_SIDE_LABEL: Record<TaskCheckSide, string> = {
  developer: "Developer",
  client: "Client",
};

export function statusLabel(status: TaskStatus): string {
  return TASK_STATUS_META[status].label;
}

/** Resolved tasks count toward progress and appear under the "Done" filter. */
export function isResolved(task: Pick<Task, "status">): boolean {
  return RESOLVED_TASK_STATUSES.includes(task.status);
}
