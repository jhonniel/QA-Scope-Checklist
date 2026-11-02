import type { ChecklistSection, ProjectStats, Task } from "@scope/contracts";
import { isOverdue } from "./date";
import { isResolved } from "./taskStatus";

/** Derive project statistics from its tasks and sections. */
export function computeStats(tasks: Task[], sections: ChecklistSection[]): ProjectStats {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(isResolved).length;
  return {
    totalTasks,
    completedTasks,
    completionPercent: totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
    sectionCount: sections.length,
    overdueTasks: tasks.filter((t) => !isResolved(t) && isOverdue(t.dueDate)).length,
  };
}

export function sectionProgress(tasks: Task[]): { total: number; completed: number; percent: number } {
  const total = tasks.length;
  const completed = tasks.filter(isResolved).length;
  return { total, completed, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}
