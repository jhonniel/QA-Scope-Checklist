import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { motion } from "framer-motion";
import { Activity, ArrowUpRight, CalendarDays, FileDown, FolderX, Layers, Plus, Settings2, Users } from "lucide-react";
import { defaultPhaseColor, groupSectionsByPhase, SECTION_KIND_LABELS, type ChecklistSection, type Phase, type SectionKind, type Task } from "@scope/contracts";
import { routes } from "@/app/routes";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { cn } from "@/lib/cn";
import { formatDueDate, formatShortDate, isOverdue, toIsoDate } from "@/lib/date";
import { riseIn, staggerChildren } from "@/lib/motion";
import { canEditProject, canManageMembers, canViewProjectActivity } from "@/lib/permissions";
import { useCollapsedSections } from "@/lib/useCollapsedSections";
import { sectionProgress } from "@/lib/stats";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { AnimatedNumber, AvatarStack, BottomSheet, Button, Card, ConfirmDialog, ConfettiBurst, EmptyState, Input, ProgressBar, SegmentedControl, Skeleton, TaskRowSkeleton } from "@/design-system";
import { selectPhasesOrEmpty, selectProject, selectProjectLoadState, selectSectionsOrEmpty, selectTasksOrEmpty, useAppStore } from "@/store/useAppStore";
import { PhaseGroupFrame } from "./PhaseGroupFrame";
import { PhaseGroupHeader } from "./PhaseGroupHeader";
import { PhaseSheet } from "./PhaseSheet";
import { resolvePhaseTone } from "./phaseTone";
import { ProjectStatusBadge } from "./ProjectStatusBadge";
import { EditProjectSheet } from "./EditProjectSheet";
import { ChecklistSectionCard } from "@/modules/checklist/ChecklistSectionCard";
import { EditSectionSheet } from "@/modules/checklist/EditSectionSheet";
import { TaskFilterBar } from "@/modules/checklist/TaskFilterBar";
import { useTaskFilter } from "@/modules/checklist/useTaskFilter";
import { useTaskSheet } from "@/modules/checklist/useTaskSheet";
import { ActivityFeed } from "@/modules/collaboration/ActivityFeed";
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
  const phases = useAppStore(selectPhasesOrEmpty(projectUuid));
  const tasks = useAppStore(selectTasksOrEmpty(projectUuid));
  const loadProject = useAppStore((s) => s.loadProject);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const activities = useAppStore((s) => s.activities);
  const activityState = useAppStore((s) => s.activityState);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const reorderTasks = useAppStore((s) => s.reorderTasks);
  const createTask = useAppStore((s) => s.createTask);
  const createSection = useAppStore((s) => s.createSection);
  const reorderSections = useAppStore((s) => s.reorderSections);
  const deletePhase = useAppStore((s) => s.deletePhase);
  const reorderPhases = useAppStore((s) => s.reorderPhases);

  const { openTask, taskUuid } = useTaskSheet();
  const [query, setQuery] = useSearchQuery();
  const { filter, setFilter, filtered, counts, isFiltering } = useTaskFilter(tasks, query);
  const { isCollapsed, toggle: toggleCollapsed } = useCollapsedSections(projectUuid);
  const [membersOpen, setMembersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<ChecklistSection | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionKind, setSectionKind] = useState<SectionKind>("scope");
  const [sectionRevisionDate, setSectionRevisionDate] = useState("");
  /** Phase the in-progress add form belongs to; empty string = ungrouped. */
  const [sectionPhaseUuid, setSectionPhaseUuid] = useState("");
  const [phaseSheet, setPhaseSheet] = useState<Phase | "new" | null>(null);
  const [deletingPhase, setDeletingPhase] = useState<Phase | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);

  // Confetti when the last task is ticked off while viewing this project.
  const progressRef = useRef<HTMLDivElement>(null);
  const celebrate = useCompletionCelebration(project?.stats.completionPercent, projectUuid);

  useEffect(() => {
    if (!projectUuid) return;
    setActiveProject(projectUuid);
    void loadProject(projectUuid);
    void loadActivity();
  }, [projectUuid, loadProject, loadActivity, setActiveProject]);

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

  const groups = useMemo(() => groupSectionsByPhase(sections, phases), [sections, phases]);
  const projectActivity = useMemo(() => activities.filter((a) => a.projectUuid === projectUuid), [activities, projectUuid]);

  const moveSection = (groupIndex: number, index: number, delta: -1 | 1) => {
    const copies = groups.map((group) => ({ ...group, sections: [...group.sections] }));
    const group = copies[groupIndex];
    const target = index + delta;
    if (!group || target < 0 || target >= group.sections.length) return;
    [group.sections[index], group.sections[target]] = [group.sections[target], group.sections[index]];
    void reorderSections(
      projectUuid,
      copies.flatMap((g) => g.sections.map((s) => s.uuid)),
    ).catch(() => undefined);
  };

  const movePhase = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= phases.length) return;
    const ordered = phases.map((p) => p.uuid);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    void reorderPhases(projectUuid, ordered);
  };

  const submitSection = async (e: FormEvent) => {
    e.preventDefault();
    const title = sectionTitle.trim();
    if (!title) return;
    await createSection(projectUuid, title, sectionKind, sectionPhaseUuid || null, sectionKind === "revision" ? sectionRevisionDate || null : null);
    setSectionTitle("");
    setSectionKind("scope");
    setSectionRevisionDate("");
    setAddingSection(false);
  };

  const startAddSection = (phaseUuid = "") => {
    setSectionPhaseUuid(phaseUuid);
    setSectionTitle("");
    setSectionKind("scope");
    setSectionRevisionDate(toIsoDate(new Date()));
    setAddingSection(true);
  };

  const cancelAddSection = () => {
    setAddingSection(false);
    setSectionTitle("");
    setSectionKind("scope");
    setSectionRevisionDate("");
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
  const canViewActivity = canViewProjectActivity(project, currentUser);
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
        <TaskFilterBar
          layoutId="project-task-filter"
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          query={query}
          onQueryChange={setQuery}
          trailing={
            canViewActivity ? (
              <Button variant="secondary" size="sm" className="shrink-0" leadingIcon={<Activity className="size-4" aria-hidden />} onClick={() => setActivityOpen(true)}>
                Activity log
              </Button>
            ) : undefined
          }
        />
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
      ) : sections.length === 0 && phases.length === 0 ? (
        <EmptyState
          icon={<Plus />}
          title="No scopes yet"
          description={canEdit ? "Scopes group related tasks. Add the first one to start the checklist." : "The project owner has not added any scopes yet."}
          action={canEdit ? <Button variant="primary" onClick={() => setAddingSection(true)}>Add scope</Button> : undefined}
        />
      ) : (
        <motion.div variants={staggerChildren(0.05)} initial="hidden" animate="visible" className="mt-5 space-y-6">
          {groups.map((group, groupIndex) => {
            const visible = group.sections.filter((section) => !isFiltering || (tasksBySection.get(section.uuid) ?? []).length > 0);
            if (isFiltering && visible.length === 0 && group.phase) return null;
            const addingHere = addingSection && sectionPhaseUuid === (group.phase?.uuid ?? "");
            const phaseIndex = group.phase ? phases.findIndex((p) => p.uuid === group.phase!.uuid) : -1;
            const tone = group.phase ? resolvePhaseTone(group.phase.color) : null;
            const cards = (
              <>
                {visible.map((section) => {
                  const sectionTasks = tasksBySection.get(section.uuid) ?? [];
                  const index = group.sections.findIndex((s) => s.uuid === section.uuid);
                  return (
                    <motion.div key={section.uuid} variants={riseIn} layout="position">
                      <ChecklistSectionCard
                        actions={
                          canEdit
                            ? {
                                onEdit: () => setEditingSection(section),
                                onMoveUp: index > 0 ? () => moveSection(groupIndex, index, -1) : undefined,
                                onMoveDown: index < group.sections.length - 1 ? () => moveSection(groupIndex, index, 1) : undefined,
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
                        collapsed={!isFiltering && isCollapsed(section.uuid)}
                        onToggleCollapsed={isFiltering ? undefined : () => toggleCollapsed(section.uuid)}
                      />
                    </motion.div>
                  );
                })}
                {visible.length === 0 && !isFiltering && group.phase && (
                  <p className="px-1 py-3 text-center text-sm text-ink-faint">This phase is empty. Add a scope or a revision to put work in it.</p>
                )}
                {canEdit && !isFiltering && group.phase && (
                  addingHere ? (
                    <AddSectionForm
                      title={sectionTitle}
                      kind={sectionKind}
                      revisionDate={sectionRevisionDate}
                      onTitle={setSectionTitle}
                      onKind={setSectionKind}
                      onRevisionDate={setSectionRevisionDate}
                      onSubmit={submitSection}
                      onCancel={cancelAddSection}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startAddSection(group.phase!.uuid)}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-medium transition-colors hover:bg-white/70"
                      style={tone ? { borderColor: tone.line, color: tone.mark } : undefined}
                    >
                      <Plus className="size-4" aria-hidden /> Add scope or revision
                    </button>
                  )
                )}
              </>
            );
            if (!group.phase) {
              return (
                <div key="ungrouped" className="space-y-4">
                  {phases.length > 0 && visible.length > 0 && <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">Ungrouped</p>}
                  {cards}
                </div>
              );
            }
            return (
              <PhaseGroupFrame
                key={group.phase.uuid}
                tone={tone!}
                label={group.phase.title}
                header={
                  <PhaseGroupHeader
                    title={group.phase.title}
                    meta={phaseHoldings(group.sections)}
                    canEdit={canEdit && !isFiltering}
                    onMoveUp={phaseIndex > 0 ? () => movePhase(phaseIndex, -1) : undefined}
                    onMoveDown={phaseIndex < phases.length - 1 ? () => movePhase(phaseIndex, 1) : undefined}
                    onEdit={() => setPhaseSheet(group.phase)}
                    onDelete={() => setDeletingPhase(group.phase)}
                  />
                }
              >
                {cards}
              </PhaseGroupFrame>
            );
          })}
          {isFiltering && filtered.length === 0 && <p className="py-8 text-center text-sm text-ink-faint">No tasks match the current filter.</p>}
        </motion.div>
      )}

      {/* Add phase (modal), or an ungrouped scope/revision when not adding inside a phase. */}
      {ready && canEdit && (
        <div className="mt-4 space-y-2">
          {addingSection && !sectionPhaseUuid ? (
            <AddSectionForm
              title={sectionTitle}
              kind={sectionKind}
              revisionDate={sectionRevisionDate}
              onTitle={setSectionTitle}
              onKind={setSectionKind}
              onRevisionDate={setSectionRevisionDate}
              onSubmit={submitSection}
              onCancel={cancelAddSection}
            />
          ) : (
            <div className={cn("grid gap-2", phases.length > 0 ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
              <button
                type="button"
                onClick={() => setPhaseSheet("new")}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-medium text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface hover:text-ink"
              >
                <Layers className="size-4" aria-hidden /> Add phase
              </button>
              <button
                type="button"
                onClick={() => startAddSection("")}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm font-medium text-ink-muted transition-colors hover:border-ink-faint hover:bg-surface hover:text-ink"
              >
                <Plus className="size-4" aria-hidden /> {phases.length > 0 ? "Add ungrouped scope or revision" : "Add scope or revision"}
              </button>
            </div>
          )}
        </div>
      )}

      {project && (
        <>
          <ManageMembersSheet project={project} open={membersOpen} onClose={() => setMembersOpen(false)} />
          {canEdit && <EditProjectSheet project={project} open={settingsOpen} onClose={() => setSettingsOpen(false)} canManage={canManage} />}
          {canEdit && (
            <PhaseSheet
              key={phaseSheet === "new" ? "new" : phaseSheet?.uuid ?? "closed"}
              open={phaseSheet !== null}
              onClose={() => setPhaseSheet(null)}
              projectUuid={project.uuid}
              phase={phaseSheet && phaseSheet !== "new" ? phaseSheet : null}
              defaultColor={defaultPhaseColor(phases.length)}
            />
          )}
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
          {canViewActivity && (
            <BottomSheet
              open={activityOpen}
              onClose={() => setActivityOpen(false)}
              title="Activity log"
              description="Every change on this project. Only you can see this as the owner."
              snapPoints={[0.72, 0.94]}
              desktop="panel"
              desktopWidthClassName="max-w-md"
              headerActions={
                <Link to={routes.activity(project.uuid)} className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-muted hover:text-ink">
                  View all <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              }
            >
              <ActivityFeed activities={projectActivity} loading={activityState !== "ready"} compact limit={40} emptyText="No activity yet." />
            </BottomSheet>
          )}
          <ConfirmDialog
            open={deletingPhase !== null}
            onClose={() => setDeletingPhase(null)}
            onConfirm={async () => {
              if (!deletingPhase) return;
              await deletePhase(deletingPhase.uuid);
            }}
            destructive
            title={`Delete “${deletingPhase?.title ?? "phase"}”?`}
            description="Scopes and revisions in this phase stay on the project; they are just ungrouped."
            confirmLabel="Delete phase"
          />
        </>
      )}
    </div>
  );
}

function phaseHoldings(sections: ChecklistSection[]): string {
  const scopes = sections.filter((s) => s.kind === "scope").length;
  const revisions = sections.filter((s) => s.kind === "revision").length;
  if (scopes === 0 && revisions === 0) return "Empty — add a scope or revision";
  const parts: string[] = [];
  if (scopes > 0) parts.push(`${scopes} ${scopes === 1 ? "scope" : "scopes"}`);
  if (revisions > 0) parts.push(`${revisions} ${revisions === 1 ? "revision" : "revisions"}`);
  return parts.join(" · ");
}

function AddSectionForm({
  title,
  kind,
  revisionDate,
  onTitle,
  onKind,
  onRevisionDate,
  onSubmit,
  onCancel,
}: {
  title: string;
  kind: SectionKind;
  revisionDate: string;
  onTitle: (value: string) => void;
  onKind: (kind: SectionKind) => void;
  onRevisionDate: (value: string) => void;
  onSubmit: (e: FormEvent) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={(e) => void onSubmit(e)} className="rounded-xl border border-dashed border-line-strong bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-ink-muted">Add a</span>
        <SegmentedControl
          value={kind}
          onChange={onKind}
          options={[
            { value: "scope", label: SECTION_KIND_LABELS.scope },
            { value: "revision", label: SECTION_KIND_LABELS.revision },
          ]}
          ariaLabel="What to add"
          layoutId="add-section-kind"
        />
        <span className="text-xs text-ink-faint">
          {kind === "revision" ? "A change request kept beside the agreed scope." : "Agreed work for this phase."}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={kind === "revision" ? "Revision title" : "Scope title"}
          aria-label={kind === "revision" ? "Revision title" : "Scope title"}
          wrapperClassName="min-w-[12rem] flex-1"
          autoFocus
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
        />
        {kind === "revision" && (
          <Input
            type="date"
            value={revisionDate}
            onChange={(e) => onRevisionDate(e.target.value)}
            aria-label="Revision date"
            wrapperClassName="w-[10.5rem]"
          />
        )}
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          Add
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
