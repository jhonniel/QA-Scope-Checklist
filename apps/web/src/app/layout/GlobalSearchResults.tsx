import { useEffect, useMemo } from "react";
import { FolderKanban, Layers, ListChecks } from "lucide-react";
import { SECTION_KIND_LABELS } from "@scope/contracts";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/cn";
import { searchWorkspace } from "@/lib/search";
import { TaskStatusBadge } from "@/modules/checklist/TaskStatusBadge";
import { useAppStore } from "@/store/useAppStore";

/** One row the user can land on with the arrow keys. */
export type SearchResultItem =
  | { kind: "project"; uuid: string }
  | { kind: "section"; uuid: string; projectUuid: string }
  | { kind: "task"; uuid: string; projectUuid: string };

export interface GlobalSearchResultsProps {
  query: string;
  /** Index of the highlighted row (keyboard); `-1` for none. */
  activeIndex: number;
  /** Lets the parent know the flattened rows so Enter and the arrows can address them. */
  onItemsChange: (items: SearchResultItem[]) => void;
  onPick: (item: SearchResultItem) => void;
  onHover: (index: number) => void;
  id: string;
}

const MAX_PROJECTS = 4;
const MAX_SECTIONS = 4;
const MAX_TASKS = 8;

/**
 * Dropdown under the top-bar search on pages that do not filter themselves:
 * matching projects, then matching tasks across every project the user can
 * see. Projects not yet in the cache are loaded on demand the first time a
 * query is typed, so the results cover the whole workspace.
 */
export function GlobalSearchResults({ query, activeIndex, onItemsChange, onPick, onHover, id }: GlobalSearchResultsProps) {
  const projects = useAppStore((s) => s.projects);
  const tasksByProject = useAppStore((s) => s.tasksByProject);
  const sectionsByProject = useAppStore((s) => s.sectionsByProject);
  const loadProject = useAppStore((s) => s.loadProject);
  const pendingProjects = useAppStore(useShallow((s) => s.projects.filter((p) => (s.projectLoadState[p.uuid] ?? "idle") !== "ready").map((p) => p.uuid)));

  // Fill the cache for every project the first time a search runs; `loadProject` is a no-op for ready/loading ones.
  useEffect(() => {
    if (!query.trim()) return;
    for (const uuid of pendingProjects) void loadProject(uuid);
  }, [query, pendingProjects, loadProject]);

  const result = useMemo(
    () => searchWorkspace(query, projects, tasksByProject, sectionsByProject, { maxProjects: MAX_PROJECTS, maxSections: MAX_SECTIONS, maxTasks: MAX_TASKS }),
    [query, projects, tasksByProject, sectionsByProject],
  );

  const items = useMemo<SearchResultItem[]>(
    () => [
      ...result.projects.map((p) => ({ kind: "project" as const, uuid: p.uuid })),
      ...result.sections.map((h) => ({ kind: "section" as const, uuid: h.section.uuid, projectUuid: h.project.uuid })),
      ...result.tasks.map((h) => ({ kind: "task" as const, uuid: h.task.uuid, projectUuid: h.project.uuid })),
    ],
    [result],
  );
  useEffect(() => onItemsChange(items), [items, onItemsChange]);

  const loading = pendingProjects.length > 0;
  const empty = result.projects.length === 0 && result.sections.length === 0 && result.tasks.length === 0;
  const sectionOffset = result.projects.length;

  return (
    <div
      id={id}
      role="listbox"
      aria-label="Search results"
      className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg"
    >
      {result.projects.length > 0 && (
        <Group label="Projects">
          {result.projects.map((p, i) => (
            <Row key={p.uuid} id={`${id}-${i}`} active={activeIndex === i} onPick={() => onPick(items[i])} onHover={() => onHover(i)}>
              <FolderKanban className="size-4 shrink-0 text-ink-faint" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
              <span className="shrink-0 text-xs tabular text-ink-faint">{p.stats.completionPercent}%</span>
            </Row>
          ))}
        </Group>
      )}
      {result.sections.length > 0 && (
        <Group label="Scopes and revisions">
          {result.sections.map((hit, offset) => {
            const i = sectionOffset + offset;
            return (
              <Row key={hit.section.uuid} id={`${id}-${i}`} active={activeIndex === i} onPick={() => onPick(items[i])} onHover={() => onHover(i)}>
                <Layers className="size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{hit.section.title}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {hit.project.name} · {SECTION_KIND_LABELS[hit.section.kind]}
                  </span>
                </span>
              </Row>
            );
          })}
        </Group>
      )}
      {result.tasks.length > 0 && (
        <Group label="Tasks">
          {result.tasks.map((hit, offset) => {
            const i = sectionOffset + result.sections.length + offset;
            return (
              <Row key={hit.task.uuid} id={`${id}-${i}`} active={activeIndex === i} onPick={() => onPick(items[i])} onHover={() => onHover(i)}>
                <ListChecks className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{hit.task.title}</span>
                  <span className="block truncate text-xs text-ink-faint">
                    {hit.project.name}
                    {hit.section ? ` › ${hit.section.title}` : ""}
                  </span>
                </span>
                <TaskStatusBadge status={hit.task.status} className="shrink-0" />
              </Row>
            );
          })}
          {result.truncated && <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-ink-faint">Showing the first {MAX_TASKS} tasks — keep typing to narrow it down.</p>}
        </Group>
      )}
      {empty && (
        <p className="px-3 py-4 text-center text-sm text-ink-faint" role="status">
          {loading ? "Searching…" : `No projects, scopes or tasks match “${query.trim()}”.`}
        </p>
      )}
      {!empty && loading && (
        <p className="px-2.5 pt-1 pb-1 text-[11px] text-ink-faint" role="status">
          Still loading some projects…
        </p>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="py-1">
      <p className="px-2.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function Row({ id, active, onPick, onHover, children }: { id: string; active: boolean; onPick: () => void; onHover: () => void; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      // mousedown (not click) so the input's blur does not close the panel before the pick registers.
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      onMouseEnter={onHover}
      className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors", active ? "bg-accent-soft" : "hover:bg-surface-muted")}
    >
      {children}
    </div>
  );
}
