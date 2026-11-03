import type { ReactNode } from "react";
import { SearchInput, SegmentedControl } from "@/design-system";
import type { TaskFilter } from "./useTaskFilter";

export interface TaskFilterBarProps {
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  counts: { all: number; open: number; done: number };
  query: string;
  onQueryChange: (q: string) => void;
  layoutId: string;
  /** Right-aligned control on the same row as the segments (e.g. activity log). */
  trailing?: ReactNode;
}

/** Status segments + (mobile-only) search; desktop search lives in the top bar. */
export function TaskFilterBar({ filter, onFilterChange, counts, query, onQueryChange, layoutId, trailing }: TaskFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl<TaskFilter>
          layoutId={layoutId}
          ariaLabel="Filter tasks"
          value={filter}
          onChange={onFilterChange}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "open", label: "Open", count: counts.open },
            { value: "done", label: "Done", count: counts.done },
          ]}
        />
        {trailing}
      </div>
      <SearchInput value={query} onChange={onQueryChange} placeholder="Search tasks" className="md:hidden" aria-label="Search tasks" />
    </div>
  );
}
