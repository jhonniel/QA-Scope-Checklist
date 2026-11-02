import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, FolderX, Pencil } from "lucide-react";
import { SECTION_KIND_LABELS } from "@scope/contracts";
import { routes } from "@/app/routes";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { canEditProject } from "@/lib/permissions";
import { sectionProgress } from "@/lib/stats";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { AnimatedNumber, Button, Card, ConfettiBurst, EmptyState, ProgressRing, Skeleton, TaskRowSkeleton } from "@/design-system";
import { selectProject, selectProjectLoadState, selectSectionsOrEmpty, selectTasksOrEmpty, useAppStore } from "@/store/useAppStore";
import { EditSectionSheet } from "./EditSectionSheet";
import { RevisionBadge } from "./RevisionBadge";
import { TaskList } from "./TaskList";
import { QuickAddTask } from "./QuickAddTask";
import { TaskFilterBar } from "./TaskFilterBar";
import { useTaskFilter } from "./useTaskFilter";
import { useTaskSheet } from "./useTaskSheet";

/** Focused view of a single checklist section (reached by "slide to drill in"). */
export function SectionPage() {
  const { projectUuid = "", sectionUuid = "" } = useParams();
  const project = useAppStore(selectProject(projectUuid));
  const currentUser = useAppStore((s) => s.currentUser);
  const loadState = useAppStore(selectProjectLoadState(projectUuid));
  const sections = useAppStore(selectSectionsOrEmpty(projectUuid));
  const allTasks = useAppStore(selectTasksOrEmpty(projectUuid));
  const loadProject = useAppStore((s) => s.loadProject);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const reorderTasks = useAppStore((s) => s.reorderTasks);
  const createTask = useAppStore((s) => s.createTask);
  const { openTask, taskUuid } = useTaskSheet();
  const [query, setQuery] = useSearchQuery();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectUuid) return;
    setActiveProject(projectUuid);
    void loadProject(projectUuid);
  }, [projectUuid, loadProject, setActiveProject]);

  const section = sections.find((s) => s.uuid === sectionUuid);
  const tasks = useMemo(() => allTasks.filter((t) => t.sectionUuid === sectionUuid).sort((a, b) => a.position - b.position), [allTasks, sectionUuid]);
  const { filter, setFilter, filtered, counts, isFiltering } = useTaskFilter(tasks, query);
  const progress = sectionProgress(tasks);
  const ready = loadState === "ready";
  const canEdit = canEditProject(project, currentUser);
  const kindLabel = SECTION_KIND_LABELS[section?.kind ?? "scope"];
  const noun = kindLabel.toLowerCase();

  // Confetti from the ring when the section's last task is resolved; a bigger burst if that also completes the project.
  const ringRef = useRef<HTMLDivElement>(null);
  const celebrateSection = useCompletionCelebration(section ? progress.percent : undefined, sectionUuid);
  const celebrateProject = useCompletionCelebration(project?.stats.completionPercent, projectUuid);

  if (ready && !section) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 lg:px-8">
        <EmptyState
          icon={<FolderX />}
          title="Scope not found"
          action={
            <Link to={routes.project(projectUuid)} className="text-sm font-medium text-accent hover:underline">
              Back to project
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-8 lg:py-8">
      <Link to={routes.project(projectUuid)} className="hidden items-center gap-1 text-sm text-ink-muted hover:text-ink lg:inline-flex">
        <ArrowLeft className="size-4" aria-hidden /> {project?.name ?? "Project"}
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {section ? (
            <>
              <div className="hidden items-center gap-2 lg:flex">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">{section.title}</h1>
                <RevisionBadge section={section} />
              </div>
              <RevisionBadge section={section} className="lg:hidden" />
              {section.description && <p className="mt-1 text-sm text-ink-muted">{section.description}</p>}
              <p className="mt-1 text-xs tabular text-ink-faint">
                {progress.completed} of {progress.total} complete
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ready && canEdit && (
            <Button variant="secondary" size="icon" onClick={() => setEditing(true)} aria-label={`Edit ${noun}`}>
              <Pencil className="size-4" aria-hidden />
            </Button>
          )}
          <div ref={ringRef} className="inline-flex">
            <ProgressRing value={progress.percent} size={64} strokeWidth={6} label={`${kindLabel} completion`}>
              <AnimatedNumber value={progress.percent} suffix="%" className="text-xs font-semibold tabular text-ink" />
            </ProgressRing>
          </div>
        </div>
      </div>
      <ConfettiBurst fire={celebrateSection} originRef={ringRef} count={70} announcement={section ? `${kindLabel} "${section.title}" is complete.` : undefined} />
      <ConfettiBurst fire={celebrateProject} announcement={project ? `${project.name} is complete — every task is done.` : undefined} />

      <div className="mt-5">
        <TaskFilterBar layoutId="section-task-filter" filter={filter} onFilterChange={setFilter} counts={counts} query={query} onQueryChange={setQuery} />
      </div>

      <Card padded={false} className="mt-4 px-5 py-3">
        {!ready ? (
          <>
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            <TaskRowSkeleton />
            <TaskRowSkeleton />
          </>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">{isFiltering ? "No tasks match." : canEdit ? "No tasks yet. Add the first one below." : "No tasks yet."}</p>
        ) : (
          <TaskList
            tasks={filtered}
            onToggleCheck={(t, side) => void toggleCheck(t.uuid, side)}
            onOpen={(t) => openTask(t.uuid)}
            onReorder={isFiltering ? undefined : (ordered) => void reorderTasks(projectUuid, sectionUuid, ordered.map((t) => t.uuid))}
            selectedUuid={taskUuid}
            readOnly={!canEdit}
          />
        )}
        {ready && !isFiltering && canEdit && (
          <QuickAddTask
            className={isFiltering ? "-mx-3 mt-1" : "-mx-3 mt-1 lg:mx-0 lg:ml-5"}
            onAdd={async (title) => {
              await createTask(projectUuid, { sectionUuid, title });
            }}
          />
        )}
      </Card>

      {canEdit && (
        <EditSectionSheet
          section={section ?? null}
          taskCount={tasks.length}
          isLastSection={sections.length <= 1}
          open={editing}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate(routes.project(projectUuid), { replace: true })}
        />
      )}
    </div>
  );
}
