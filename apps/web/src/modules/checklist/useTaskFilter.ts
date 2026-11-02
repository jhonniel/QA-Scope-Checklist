import { useMemo, useState } from "react";
import type { Task } from "@scope/contracts";
import { isResolved, statusLabel } from "@/lib/taskStatus";

export type TaskFilter = "all" | "open" | "done";

/** Shared filter + search logic for task lists. "Done" = resolved status. */
export function useTaskFilter(tasks: Task[], query: string) {
  const [filter, setFilter] = useState<TaskFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      const resolved = isResolved(t);
      if (filter === "open" && resolved) return false;
      if (filter === "done" && !resolved) return false;
      if (
        q &&
        !t.title.toLowerCase().includes(q) &&
        !(t.description ?? "").toLowerCase().includes(q) &&
        !statusLabel(t.status).toLowerCase().includes(q) &&
        !(t.assignee?.name.toLowerCase().includes(q) ?? false)
      )
        return false;
      return true;
    });
  }, [tasks, filter, query]);

  const counts = useMemo(
    () => ({
      all: tasks.length,
      open: tasks.filter((t) => !isResolved(t)).length,
      done: tasks.filter(isResolved).length,
    }),
    [tasks],
  );

  const isFiltering = filter !== "all" || query.trim().length > 0;

  return { filter, setFilter, filtered, counts, isFiltering };
}
