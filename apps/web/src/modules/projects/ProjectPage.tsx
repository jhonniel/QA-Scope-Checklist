import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { motion } from "framer-motion";
import { CalendarDays, FileDown, FolderX, Plus, Settings2, Users } from "lucide-react";
import type { ChecklistSection, Task } from "@scope/contracts";
import { routes } from "@/app/routes";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { cn } from "@/lib/cn";
import { formatDueDate, formatShortDate, isOverdue } from "@/lib/date";
import { riseIn, staggerChildren } from "@/lib/motion";
import { canEditProject, canManageMembers } from "@/lib/permissions";
import { sectionProgress } from "@/lib/stats";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { AnimatedNumber, AvatarStack, Button, Card, ConfettiBurst, EmptyState, Input, ProgressBar, Skeleton, TaskRowSkeleton } from "@/design-system";
import { selectProject, selectProjectLoadState, selectSectionsOrEmpty, selectTasksOrEmpty, useAppStore } from "@/store/useAppStore";
import { ProjectStatusBadge } from "./ProjectStatusBadge";
import { EditProjectSheet } from "./EditProjectSheet";
import { ChecklistSectionCard } from "@/modules/checklist/ChecklistSectionCard";
import { EditSectionSheet } from "@/modules/checklist/EditSectionSheet";
import { TaskFilterBar } from "@/modules/checklist/TaskFilterBar";
import { useTaskFilter } from "@/modules/checklist/useTaskFilter";
import { useTaskSheet } from "@/modules/checklist/useTaskSheet";
import { ManageMembersSheet } from "@/modules/collaboration/ManageMembersSheet";
import { ExportPreviewSheet } from "@/modules/export/ExportPreviewSheet";

/** Project workspace: summary, filters, and every checklist section. */
export function ProjectPage() {
  const { projectUuid = "" } = useParams();
  const bootState = useAppStore((s) => s.bootState);
  const currentUser = useAppStore((s) => s.currentUser);
  const project = useAppStore(selectProject(projectUuid));
  const loadState = useAppStore(selectProjectLoadState(projectUuid));
  const sections = useAppStore(selectSectionsOrEmpty(projectUuid));
  const tasks = useAppStore(selectTasksOrEmpty(projectUuid));
  const loadProject = useAppStore((s) => s.loadProject);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const reorderTasks = useAppStore((s) => s.reorderTasks);
  const createTask = useAppStore((s) => s.createTask);
  const createSection = useAppStore((s) => s.createSection);
  const reorderSections = useAppStore((s) => s.reorderSections);

  const { openTask, taskUuid } = useTaskSheet();
  const [query, setQuery] = useSearchQuery();
  const { filter, setFilter, filtered, counts, isFiltering } = useTaskFilter(tasks, query);
  const [membersOpen, setMembersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<ChecklistSection | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");

  // Confetti when the last task is ticked off while viewing this project.
  const progressRef = useRef<HTMLDivElement>(null);
  const celebrate = useCompletionCelebration(project?.stats.completionPercent, projectUuid);

  useEffect(() => {
    if (!projectUuid) return;
    setActiveProject(projectUuid);
    void loadProject(projectUuid);
  }, [projectUuid, loadProject, setActiveProject]);

  const tasksBySection = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of filtered) {
      const list = map.get(t.sectionUuid) ?? [];
      list.push(t);
      map.set(t.sectionUuid, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [filtered]);

  // Unfiltered completion per section, so a "Done" filter never looks like a finished section.
  const sectionCompletion = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sections) map.set(s.uuid, sectionProgress(tasks.filter((t) => t.sectionUuid === s.uuid)).percent);
    return map;
  }, [sections, tasks]);

  const moveSection = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const ordered = sections.map((s) => s.uuid);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    void reorderSections(projectUuid, ordered).catch(() => undefined);
  };

  const submitSection = async (e: FormEvent) => {
    e.preventDefault();
    const title = sectionTitle.trim();
    if (!title) return;
    await createSection(projectUuid, title);
    setSectionTitle("");
    setAddingSection(false);
  };

  if (bootState === "ready" && !project) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 lg:px-8">
        <EmptyState
          icon={<FolderX />}
          title="Project not found"
          description="It may have been removed, or you no longer have access."
          action={
            <Link to={routes.projects()} className="text-sm font-medium text-accent hover:underline">
              Back to projects
            </Link>
          }
        />
      </div>
    );
  }

  const ready = !!project && loadState === "ready";
  const canEdit = canEditProject(project, currentUser);
  const canManage = canManageMembers(project, currentUser);
  const deadlineOverdue = !!project && project.status === "active" && isOverdue(project.deadline);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
      {/* Header */}
      {project ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={project.status} />
              {project.deadline && (
                <span className={cn("inline-flex items-center gap-1 text-xs tabular text-ink-muted", deadlineOverdue && "font-medium text-danger")}>
                  <CalendarDays className="size-3.5" aria-hidden />
                  {project.startDate ? `${formatShortDate(project.startDate)} → ` : ""}
                  {formatDueDate(project.deadline)}
                </span>
              )}
            </div>
            <h1 className="mt-2 hidden text-2xl font-semibold tracking-tight text-ink lg:block">{project.name}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{project.description}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => setMembersOpen(true)} className="flex items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-3 pl-1.5 hover:bg-surface-muted" aria-label="Manage members">
              <AvatarStack users={project.members.map((m) => m.user)} max={3} size="sm" />
              <span className="text-xs font-medium text-ink-muted">{project.members.length}</span>
              <Users className="size-4 text-ink-faint" aria-hidden />
            </button>
            {canEdit && (
              <Button variant="secondary" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Project settings">
                <Settings2 className="size-4" aria-hidden />
              </Button>
            )}
            <Button variant="primary" leadingIcon={<FileDown className="size-4" aria-hidden />} onClick={() => setExportOpen(true)} disabled={!ready}>
              Export
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-[60%]" />
        </div>
      )}

      {/* Progress strip */}
      <Card ref={progressRef} className="mt-5 flex items-center gap-4 px-5 py-4">
        {project ? (
          <>
            <AnimatedNumber value={project.stats.completionPercent} suffix="%" className="text-2xl font-semibold tabular text-ink" />
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between text-xs text-ink-muted">
                <span>
                  {project.stats.completedTasks} of {project.stats.totalTasks} tasks complete
                </span>
                {project.stats.overdueTasks > 0 && <span className="font-medium text-danger">{project.stats.overdueTasks} overdue</span>}
              </div>
              <ProgressBar value={project.stats.completionPercent} label="Project completion" />
            </div>
          </>
        ) : (
          <Skeleton className="h-8 w-full" />
        )}
      </Card>
      <ConfettiBurst fire={celebrate} originRef={progressRef} announcement={project ? `${project.name} is complete — every task is done.` : undefined} />

      {/* Filters */}
      <div className="mt-5">
        <TaskFilterBar layoutId="project-task-filter" filter={filter} onFilterChange={setFilter} counts={counts} query={query} onQueryChange={setQuery} />
      </div>

      {/* Sections */}
      {!ready ? (
        <div className="mt-5 space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} padded={false} aria-hidden>
              <div className="px-5 pt-4">
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="px-5 py-2">
                <TaskRowSkeleton />
                <TaskRowSkeleton />
                <TaskRowSkeleton />
              </div>
            </Card>
          ))}
        </div>
      ) : sections.length === 0 ? (
        <EmptyState
          icon={<Plus />}
          title="No sections yet"
          description={canEdit ? "Sections group related tasks. Add the first one to start the checklist." : "The project owner has not added any sections yet."}
          action={canEdit ? <Button variant="primary" onClick={() => setAddingSection(true)}>Add section</Button> : undefined}
        />
      ) : (
        <motion.div variants={staggerChildren(0.05)} initial="hidden" animate="visible" className="mt-5 space-y-4">
          {sections.map((section, index) => {
            const sectionTasks = tasksBySection.get(section.uuid) ?? [];
            if (isFiltering && sectionTasks.length === 0) return null;
            return (
              <motion.div key={section.uuid} variants={riseIn} layout="position">
                <ChecklistSectionCard
                  actions={
                    canEdit
                      ? {
                          onEdit: () => setEditingSection(section),
                          onMoveUp: index > 0 ? () => moveSection(index, -1) : undefined,
                          onMoveDown: index < sections.length - 1 ? () => moveSection(index, 1) : undefined,
                        }
                      : undefined
                  }
                  section={section}
                  tasks={sectionTasks}
                  completionPercent={sectionCompletion.get(section.uuid) ?? 0}
                  onToggleCheck={(t, side) => void toggleCheck(t.uuid, side)}
                  onOpen={(t) => openTask(t.uuid)}
                  onReorder={(ordered) => void reorderTasks(projectUuid, section.uuid, ordered.map((t) => t.uuid))}
                  onAdd={async (title) => {
                    await createTask(projectUuid, { sectionUuid: section.uuid, title });
                  }}
                  selectedUuid={taskUuid}
                  filtered={isFiltering}
                  readOnly={!canEdit}
                />
              </motion.div>
            );
          })}
          {isFiltering && filtered.length === 0 && <p className="py-8 text-center text-sm text-ink-faint">No tasks match the current filter.</p>}
        </motion.div>
      )}

      {/* Add section */}
      {ready && canEdit && (
        <div className="mt-4">
          {addingSection ? (
            <form onSubmit={submitSection} className="flex items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface p-3">
              <Input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} placeholder="Section title" aria-label="Section title" wrapperClassName="flex-1" autoFocus onKeyDown={(e) => e.key === "Escape" && setAddingSection(false)} />
              <Button type="submit" variant="primary" disabled={!sectionTitle.trim()}>
                Add
              </Button>
              <Button variant="ghost" onClick={() => setAddingSection(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingSection(true)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-medium text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface hover:text-ink"
            >
              <Plus className="size-4" aria-hidden /> Add section
            </button>
          )}
        </div>
      )}

      {project && (
        <>
          <ManageMembersSheet project={project} open={membersOpen} onClose={() => setMembersOpen(false)} />
          {canEdit && <EditProjectSheet project={project} open={settingsOpen} onClose={() => setSettingsOpen(false)} canManage={canManage} />}
          {canEdit && (
            <EditSectionSheet
              section={editingSection}
              taskCount={editingSection ? tasks.filter((t) => t.sectionUuid === editingSection.uuid).length : 0}
              isLastSection={sections.length <= 1}
              open={editingSection !== null}
              onClose={() => setEditingSection(null)}
            />
          )}
          <ExportPreviewSheet key={`${project.uuid}-${sections.length}`} project={project} sections={sections} tasks={tasks} open={exportOpen} onClose={() => setExportOpen(false)} />
        </>
      )}
    </div>
  );
}
