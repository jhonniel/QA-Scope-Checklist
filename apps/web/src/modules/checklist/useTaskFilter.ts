import { useMemo, useState } from "react";
import type { Task } from "@scope/contracts";
import { normalizeQuery, taskMatches } from "@/lib/search";
import { isResolved } from "@/lib/taskStatus";

export type TaskFilter = "all" | "open" | "done";

/** Shared filter + search logic for task lists. "Done" = resolved status. */
export function useTaskFilter(tasks: Task[], query: string) {
  const [filter, setFilter] = useState<TaskFilter>("all");

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    return tasks.filter((t) => {
      const resolved = isResolved(t);
      if (filter === "open" && resolved) return false;
      if (filter === "done" && !resolved) return false;
      return taskMatches(t, q);
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
