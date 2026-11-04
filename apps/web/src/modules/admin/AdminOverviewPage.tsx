import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight, CalendarClock, FileDown, FolderKanban, ListChecks, MessageSquare, ShieldAlert, Trash2, Trophy, UserRound, Users } from "lucide-react";
import { TASK_STATUSES, type AdminAuditEntry, type AdminProductivity, type AdminStats } from "@scope/contracts";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";
import { TASK_STATUS_META } from "@/lib/taskStatus";
import { AnimatedNumber, BentoCard, BentoGrid, Button, CardSkeleton, MemberAvatar, Meter, ProgressBar, ProgressRing } from "@/design-system";
import { api, ApiError } from "@/services/api";
import { AuditList } from "./AuditList";

/** System-wide numbers plus the most recent administrative actions. */
export function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[] | null>(null);
  const [productivity, setProductivity] = useState<AdminProductivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.adminStats(), api.adminListAudit({ page: 1, perPage: 6 }), api.adminProductivity({ period: "30d" })])
      .then(([s, a, p]) => {
        if (cancelled) return;
        setStats(s);
        setAudit(a.items);
        setProductivity(p);
      })
      .catch((err) => {
        if (!cancelled) setError(ApiError.message(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (error) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface py-10 text-center">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => setTick((t) => t + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-busy="true" aria-label="Loading statistics">
        <CardSkeleton className="col-span-2 lg:row-span-2 lg:min-h-72" />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton className="col-span-2" />
        <CardSkeleton className="col-span-2 lg:row-span-2" />
        <CardSkeleton className="col-span-2" />
      </div>
    );
  }

  const completion = stats.tasks.total === 0 ? 0 : Math.round((stats.tasks.completed / stats.tasks.total) * 100);
  const statusRows = TASK_STATUSES.map((s) => ({ status: s, count: stats.tasks.byStatus[s] })).filter((r) => r.count > 0);
  const statusMax = Math.max(1, ...statusRows.map((r) => r.count));

  return (
    <BentoGrid className="mt-6">
      {/* Projects */}
      <BentoCard cols={2} rows={2} label="Projects" action={<SectionLink to={routes.adminProjects()} />} className="justify-between">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-4xl font-semibold tracking-tight tabular text-ink lg:text-5xl">
              <AnimatedNumber value={stats.projects.total} />
            </p>
            <p className="mt-1 text-sm text-ink-muted">live projects across every account</p>
          </div>
          <ProgressRing value={completion} size={96} strokeWidth={8} className="hidden shrink-0 sm:inline-flex" label="Overall task completion">
            <div className="text-center">
              <AnimatedNumber value={completion} suffix="%" className="block text-xl font-semibold tabular text-ink" />
              <span className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">tasks done</span>
            </div>
          </ProgressRing>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
          <Figure label="Active" value={stats.projects.active} />
          <Figure label="Completed" value={stats.projects.completed} />
          <Figure label="Archived" value={stats.projects.archived} />
          <Figure label="Deleted" value={stats.projects.deleted} hint={stats.projects.deleted > 0 ? "restorable" : undefined} />
        </dl>
        {stats.projects.overdue > 0 && (
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-danger">
            <CalendarClock className="size-3.5" aria-hidden />
            {stats.projects.overdue} active {stats.projects.overdue === 1 ? "project is" : "projects are"} past the deadline
          </p>
        )}
      </BentoCard>

      <StatTile label="Users" value={stats.users.total} hint={`${stats.users.admins} admin${stats.users.admins === 1 ? "" : "s"}${stats.users.pending ? ` · ${stats.users.pending} pending` : ""}${stats.users.disabled ? ` · ${stats.users.disabled} disabled` : ""}`} icon={<Users className="size-4" aria-hidden />} to={stats.users.pending ? `${routes.adminUsers()}?status=pending` : routes.adminUsers()} />
      <StatTile label="Active this week" value={stats.users.activeLast7Days} hint={`${stats.users.newLast30Days} joined in 30 days`} icon={<UserRound className="size-4" aria-hidden />} accent />

      {/* Tasks */}
      <BentoCard cols={2} label="Tasks" action={<span className="text-xs tabular text-ink-faint">{stats.tasks.total} total</span>}>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Completed" value={stats.tasks.completed} />
          <Figure label="Open" value={stats.tasks.total - stats.tasks.completed} />
          <Figure label="Overdue" value={stats.tasks.overdue} tone={stats.tasks.overdue > 0 ? "danger" : undefined} />
        </div>
        <ProgressBar value={completion} className="mt-4" label="Overall task completion" />
      </BentoCard>

      {/* Status breakdown */}
      <BentoCard cols={2} rows={2} label="Tasks by status">
        {statusRows.length === 0 ? (
          <p className="text-sm text-ink-faint">No tasks yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {statusRows.map(({ status, count }, index) => {
              const meta = TASK_STATUS_META[status];
              return (
                <li key={status} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} aria-hidden />
                    <span className="truncate text-ink">{meta.label}</span>
                  </span>
                  <Meter value={Math.max(4, (count / statusMax) * 100)} color={meta.color} delay={index * 0.04} />
                  <AnimatedNumber value={count} delay={index * 0.04} className="w-6 text-right tabular text-ink-muted" />
                </li>
              );
            })}
          </ul>
        )}
      </BentoCard>

      <StatTile label="Exports" value={stats.exports.total} hint={`${stats.exports.last30Days} in the last 30 days`} icon={<FileDown className="size-4" aria-hidden />} />
      <StatTile label="Changes this week" value={stats.activity.last7Days} hint="entries in project activity" icon={<ListChecks className="size-4" aria-hidden />} />

      {/* Collaboration */}
      <BentoCard cols={2} label="Collaboration">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Memberships" value={stats.collaboration.memberships} icon={<Users className="size-3.5" aria-hidden />} />
          <Figure label="Pending invites" value={stats.collaboration.pendingInvitations} icon={<FolderKanban className="size-3.5" aria-hidden />} />
          <Figure label="Comments" value={stats.collaboration.comments} icon={<MessageSquare className="size-3.5" aria-hidden />} />
        </dl>
        {stats.projects.deleted > 0 && (
          <Link to={`${routes.adminProjects()}?status=deleted`} className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink">
            <Trash2 className="size-3.5" aria-hidden /> Review {stats.projects.deleted} deleted {stats.projects.deleted === 1 ? "project" : "projects"}
          </Link>
        )}
      </BentoCard>

      {/* Errors */}
      <BentoCard cols={2} label="Errors" action={<SectionLink to={routes.adminErrors()} />}>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Figure label="Last 24 hours" value={stats.errors.last24Hours} tone={stats.errors.last24Hours > 0 ? "danger" : undefined} icon={<ShieldAlert className="size-3.5" aria-hidden />} />
          <Figure label="Last 7 days" value={stats.errors.last7Days} />
          <Figure label="All time" value={stats.errors.total} />
        </dl>
        <p className="mt-4 text-xs text-ink-muted">
          {stats.errors.last7Days === 0 ? "No failures recorded this week." : `${stats.errors.last7Days === 1 ? "One failure" : `${stats.errors.last7Days} failures`} recorded this week — unhandled API errors and crashes reported by the web app.`}
        </p>
      </BentoCard>

      {/* Productivity */}
      <BentoCard cols={2} label="Most productive · 30 days" action={<SectionLink to={routes.adminProductivity()} />}>
        <TopContributors data={productivity} />
      </BentoCard>

      {/* Audit */}
      <BentoCard cols={2} label="Recent admin actions" action={<SectionLink to={routes.adminAudit()} />}>
        <AuditList entries={audit ?? []} loading={audit === null} compact />
      </BentoCard>
    </BentoGrid>
  );
}

// ---------------------------------------------------------------------------

/** Top three accounts by weighted activity; the full ranking lives on the Productivity tab. */
function TopContributors({ data }: { data: AdminProductivity | null }) {
  const top = (data?.entries ?? []).filter((e) => e.totalActions > 0).slice(0, 3);
  const max = Math.max(1, ...top.map((e) => e.score));
  if (data && top.length === 0) return <p className="text-sm text-ink-faint">No activity recorded in the last 30 days.</p>;
  return (
    <ol className="space-y-3" aria-busy={!data}>
      {top.map((entry, index) => (
        <li key={entry.user.uuid} className="flex items-center gap-3">
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular", index === 0 ? "bg-warning text-white" : "bg-accent-soft text-accent")} aria-label={`Rank ${index + 1}`}>
            {index === 0 ? <Trophy className="size-3" aria-hidden /> : index + 1}
          </span>
          <MemberAvatar user={entry.user} size="sm" plain />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{entry.user.name}</span>
              <span className="shrink-0 text-xs tabular text-ink-muted">
                <AnimatedNumber value={entry.score} delay={index * 0.06} /> pts · {entry.counts.tasksCompleted} done
              </span>
            </div>
            <Meter value={Math.max(4, (entry.score / max) * 100)} className={index === 0 ? "bg-warning" : "bg-accent"} trackClassName="mt-1" delay={index * 0.06} />
          </div>
        </li>
      ))}
      {!data &&
        Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="size-6 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
            <span className="size-8 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
            <span className="h-3 flex-1 animate-pulse rounded bg-surface-sunken" />
          </li>
        ))}
    </ol>
  );
}

function SectionLink({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-0.5 text-xs font-medium text-ink-muted hover:text-ink">
      All <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}

function Figure({ label, value, hint, tone, icon }: { label: string; value: number; hint?: string; tone?: "danger"; icon?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-ink-faint">
        {icon}
        {label}
      </dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tabular", tone === "danger" ? "text-danger" : "text-ink")}>
        <AnimatedNumber value={value} />
        {hint && <span className="ml-1 text-xs font-normal text-ink-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function StatTile({ label, value, hint, icon, accent, to }: { label: string; value: number; hint: string; icon: ReactNode; accent?: boolean; to?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("truncate text-xs font-medium tracking-wide uppercase", accent ? "text-accent-fg/75" : "text-ink-muted")}>{label}</p>
        <span className={cn("shrink-0", accent ? "text-accent-fg/80" : "text-ink-faint")}>{icon}</span>
      </div>
      <p className="mt-auto pt-5 text-3xl font-semibold tracking-tight tabular sm:pt-6 sm:text-4xl">
        <AnimatedNumber value={value} />
      </p>
      <p className={cn("mt-1 truncate text-xs", accent ? "text-accent-fg/75" : "text-ink-muted")}>{hint}</p>
    </>
  );
  return (
    <BentoCard smCols={1} tinted={!accent} className={cn("p-4 sm:p-5", accent && "border-accent bg-accent text-accent-fg", to && "transition-colors hover:border-line-strong")}>
      {to ? (
        <Link to={to} className="flex h-full flex-col rounded-xl focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:outline-none">
          {body}
        </Link>
      ) : (
        body
      )}
    </BentoCard>
  );
}
