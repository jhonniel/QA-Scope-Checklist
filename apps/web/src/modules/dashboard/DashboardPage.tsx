import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, ArrowUpRight, CalendarClock, CheckCheck, FileDown, ListChecks, Plus } from "lucide-react";
import type { Project } from "@scope/contracts";
import { routes } from "@/app/routes";
import { PageHeader } from "@/app/layout/PageHeader";
import { cn } from "@/lib/cn";
import { formatDueDate, formatShortDate, isOverdue } from "@/lib/date";
import { sectionProgress } from "@/lib/stats";
import { canEditProject, canViewProjectActivity } from "@/lib/permissions";
import { isResolved } from "@/lib/taskStatus";
import { useCompletionCelebration } from "@/lib/useCompletionCelebration";
import { AnimatedNumber, BentoCard, BentoGrid, Button, CardSkeleton, ConfettiBurst, EmptyState, ProgressBar, ProgressRing, Select, Skeleton } from "@/design-system";
import { selectProject, selectProjectLoadState, selectSectionsOrEmpty, selectTasksOrEmpty, useAppStore } from "@/store/useAppStore";
import { ProjectStatusBadge } from "@/modules/projects/ProjectStatusBadge";
import { CreateProjectSheet } from "@/modules/projects/CreateProjectSheet";
import { MembersCard } from "@/modules/collaboration/MembersCard";
import { PendingInvitationsBanner } from "@/modules/collaboration/PendingInvitationsBanner";
import { ActivityFeed } from "@/modules/collaboration/ActivityFeed";
import { TaskRow } from "@/modules/checklist/TaskRow";
import { useTaskSheet } from "@/modules/checklist/useTaskSheet";
import { ExportPreviewSheet } from "@/modules/export/ExportPreviewSheet";

export function DashboardPage() {
  const navigate = useNavigate();
  const bootState = useAppStore((s) => s.bootState);
  const projects = useAppStore((s) => s.projects);
  const activeProjectUuid = useAppStore((s) => s.activeProjectUuid);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const project = useAppStore(selectProject(activeProjectUuid));
  const [creating, setCreating] = useState(false);

  if (bootState === "loading" || bootState === "idle") return <DashboardSkeleton />;

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8">
        <PendingInvitationsBanner className="mb-6" />
        <EmptyState
          icon={<ListChecks />}
          title="Welcome to Scope Checklist"
          description="Create your first project to start building a checklist you can share and export, or accept an invitation to join one."
          action={
            <Button variant="primary" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              New project
            </Button>
          }
        />
        <CreateProjectSheet open={creating} onClose={() => setCreating(false)} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader
        title="Dashboard"
        description="A snapshot of the project you are working on."
        actions={
          <>
            <Select
              aria-label="Switch project"
              value={project.uuid}
              onChange={(e) => setActiveProject(e.target.value)}
              wrapperClassName="w-full sm:w-64"
            >
              {projects.map((p) => (
                <option key={p.uuid} value={p.uuid}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button variant="primary" className="hidden sm:inline-flex" trailingIcon={<ArrowRight className="size-4" aria-hidden />} onClick={() => navigate(routes.project(project.uuid))}>
              Open
            </Button>
          </>
        }
      />

      <PendingInvitationsBanner className="mt-5" />
      <ProjectBento key={project.uuid} project={project} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProjectBento({ project }: { project: Project }) {
  const loadProject = useAppStore((s) => s.loadProject);
  const loadActivity = useAppStore((s) => s.loadActivity);
  const loadState = useAppStore(selectProjectLoadState(project.uuid));
  const tasks = useAppStore(selectTasksOrEmpty(project.uuid));
  const sections = useAppStore(selectSectionsOrEmpty(project.uuid));
  const activities = useAppStore((s) => s.activities);
  const activityState = useAppStore((s) => s.activityState);
  const toggleCheck = useAppStore((s) => s.toggleCheck);
  const currentUser = useAppStore((s) => s.currentUser);
  const canEdit = canEditProject(project, currentUser);
  const canViewActivity = canViewProjectActivity(project, currentUser);
  const { openTask, taskUuid } = useTaskSheet();
  const [exporting, setExporting] = useState(false);

  // Confetti when the last task is ticked off from the dashboard.
  const overviewRef = useRef<HTMLDivElement>(null);
  const celebrate = useCompletionCelebration(project.stats.completionPercent, project.uuid);

  useEffect(() => {
    void loadProject(project.uuid);
    if (canViewActivity) void loadActivity();
  }, [project.uuid, loadProject, loadActivity, canViewActivity]);

  const ready = loadState === "ready";
  const { stats } = project;

  const upcoming = useMemo(
    () =>
      tasks
        .filter((t) => !isResolved(t) && t.dueDate)
        .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
        .slice(0, 4),
    [tasks],
  );

  const projectActivity = useMemo(() => activities.filter((a) => a.projectUuid === project.uuid), [activities, project.uuid]);
  const sectionTitles = useMemo(() => new Map(sections.map((s) => [s.uuid, s.title])), [sections]);
  const deadlineOverdue = project.status === "active" && isOverdue(project.deadline);

  return (
    <>
      <BentoGrid className="mt-6">
        {/* Overview */}
        <BentoCard ref={overviewRef} cols={2} rows={2} className="justify-between">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ProjectStatusBadge status={project.status} />
                {project.deadline && (
                  <span className={cn("inline-flex items-center gap-1 text-xs tabular text-ink-muted", deadlineOverdue && "font-medium text-danger")}>
                    <CalendarClock className="size-3.5" aria-hidden />
                    {deadlineOverdue ? "Deadline passed · " : "Due "}
                    {formatDueDate(project.deadline)}
                  </span>
                )}
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink text-balance lg:text-2xl">{project.name}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-muted">{project.description}</p>
            </div>
            <ProgressRing value={stats.completionPercent} size={104} strokeWidth={8} className="hidden shrink-0 sm:inline-flex" label={`${project.name} completion`}>
              <div className="text-center">
                <AnimatedNumber value={stats.completionPercent} suffix="%" className="block text-2xl font-semibold tabular text-ink" />
                <span className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">done</span>
              </div>
            </ProgressRing>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between text-xs text-ink-muted sm:hidden">
              <span>Completion</span>
              <AnimatedNumber value={stats.completionPercent} suffix="%" className="font-medium tabular text-ink" />
            </div>
            <ProgressBar value={stats.completionPercent} className="sm:hidden" />

            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs sm:mt-0">
              <div className="min-w-0">
                <dt className="text-ink-faint">Owner</dt>
                <dd className="mt-0.5 truncate font-medium text-ink">{project.owner.name}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Started</dt>
                <dd className="mt-0.5 font-medium tabular text-ink">{formatShortDate(project.startDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Deadline</dt>
                <dd className={cn("mt-0.5 font-medium tabular", deadlineOverdue ? "text-danger" : "text-ink")}>{formatShortDate(project.deadline)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                to={routes.project(project.uuid)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
              >
                Open checklist <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Button variant="secondary" size="sm" leadingIcon={<FileDown className="size-4" aria-hidden />} onClick={() => setExporting(true)} disabled={!ready}>
                Export DOCX
              </Button>
            </div>
          </div>
        </BentoCard>

        {/* Stats */}
        <StatCard label="Total tasks" value={stats.totalTasks} hint={`${stats.sectionCount} ${stats.sectionCount === 1 ? "scope" : "scopes"}`} icon={<ListChecks className="size-4" aria-hidden />} />
        <StatCard
          label="Completed"
          value={stats.completedTasks}
          hint={stats.overdueTasks > 0 ? `${stats.overdueTasks} overdue` : "Nothing overdue"}
          hintTone={stats.overdueTasks > 0 ? "danger" : "muted"}
          icon={<CheckCheck className="size-4" aria-hidden />}
          accent
        />

        {/* Upcoming deadlines */}
        <BentoCard cols={2} label="Upcoming deadlines" flush className="pb-2">
          {!ready ? (
            <div className="space-y-3 px-5 pb-3">
              <Skeleton className="h-4 w-[70%]" />
              <Skeleton className="h-4 w-[55%]" />
              <Skeleton className="h-4 w-[62%]" />
            </div>
          ) : upcoming.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-ink-faint">No open tasks with due dates.</p>
          ) : (
            <ul className="px-2">
              {upcoming.map((t) => (
                <li key={t.uuid}>
                  <TaskRow task={t} onToggleCheck={(task, side) => void toggleCheck(task.uuid, side)} onOpen={(task) => openTask(task.uuid)} selected={t.uuid === taskUuid} context={sectionTitles.get(t.sectionUuid)} readOnly={!canEdit} />
                </li>
              ))}
            </ul>
          )}
        </BentoCard>

        {canViewActivity && (
          <BentoCard
            cols={2}
            rows={2}
            label="Recent activity"
            action={
              <Link to={routes.activity(project.uuid)} className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-muted hover:text-ink">
                All <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            }
          >
            <ActivityFeed activities={projectActivity} loading={activityState !== "ready"} compact limit={6} emptyText="No activity in this project yet." />
          </BentoCard>
        )}

        {/* Sections */}
        <BentoCard cols={2} label="Scopes and revisions" action={<span className="text-xs tabular text-ink-faint">{sections.length}</span>}>
          {!ready ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3.5 w-[50%]" />
                  <Skeleton className="h-1 w-full" />
                </div>
              ))}
            </div>
          ) : sections.length === 0 ? (
            <p className="text-sm text-ink-faint">No scopes yet.</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {sections.map((s, index) => {
                const p = sectionProgress(tasks.filter((t) => t.sectionUuid === s.uuid));
                return (
                  <li key={s.uuid}>
                    <Link to={routes.section(project.uuid, s.uuid)} className="group block rounded-md">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{s.title}</span>
                        <span className="shrink-0 text-xs tabular text-ink-faint">
                          {p.completed}/{p.total}
                        </span>
                      </div>
                      <ProgressBar value={p.percent} size="sm" className="mt-1.5" label={`${s.title} completion`} delay={index * 0.04} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCard>

        {/* Members */}
        <MembersCard project={project} cols={2} />
      </BentoGrid>

      <ExportPreviewSheet key={`${project.uuid}-${sections.length}`} project={project} sections={sections} tasks={tasks} open={exporting} onClose={() => setExporting(false)} />
      <ConfettiBurst fire={celebrate} originRef={overviewRef} announcement={`${project.name} is complete — every task is done.`} />
    </>
  );
}

function StatCard({ label, value, hint, hintTone = "muted", icon, accent }: { label: string; value: number; hint: string; hintTone?: "muted" | "danger"; icon: ReactNode; accent?: boolean }) {
  return (
    <BentoCard smCols={1} tinted={!accent} className={cn("p-4 sm:p-5", accent && "border-accent bg-accent text-accent-fg")}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("truncate text-xs font-medium tracking-wide uppercase", accent ? "text-accent-fg/75" : "text-ink-muted")}>{label}</p>
        <span className={cn("shrink-0", accent ? "text-accent-fg/80" : "text-ink-faint")}>{icon}</span>
      </div>
      <p className="mt-auto pt-5 text-3xl font-semibold tracking-tight tabular sm:pt-6 sm:text-4xl">
        <AnimatedNumber value={value} />
      </p>
      <p className={cn("mt-1 text-xs", accent ? "text-accent-fg/75" : hintTone === "danger" ? "font-medium text-danger" : "text-ink-muted")}>{hint}</p>
    </BentoCard>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8" aria-busy="true" aria-label="Loading dashboard">
      <div className="hidden lg:block">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardSkeleton className="sm:col-span-2 lg:row-span-2 lg:min-h-80" />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton className="sm:col-span-2" />
        <CardSkeleton className="sm:col-span-2 lg:row-span-2" />
        <CardSkeleton className="sm:col-span-2" />
      </div>
    </div>
  );
}
