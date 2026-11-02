import { useEffect } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { Activity, CheckSquare, FolderKanban, LayoutDashboard, MailOpen, Plus, ShieldCheck } from "lucide-react";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";
import { useAppStore } from "@/store/useAppStore";
import { MemberAvatar, ProgressBar, Skeleton } from "@/design-system";

const primaryNav = [
  { to: routes.dashboard(), label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: routes.projects(), label: "Projects", icon: FolderKanban, end: true },
  { to: routes.activity(), label: "Activity", icon: Activity, end: false },
  { to: routes.invitations(), label: "Invitations", icon: MailOpen, end: false },
];

/** Shown only to administrators (the API enforces the same rule). */
const adminNav = { to: routes.admin(), label: "Admin", icon: ShieldCheck, end: false };

/** Desktop sidebar: brand, primary navigation, project switcher, profile. */
export function Sidebar({ className }: { className?: string }) {
  const { projectUuid } = useParams();
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const bootState = useAppStore((s) => s.bootState);
  const currentUser = useAppStore((s) => s.currentUser);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const pendingInvitations = useAppStore((s) => s.myInvitations.length);
  const loadMyInvitations = useAppStore((s) => s.loadMyInvitations);

  useEffect(() => {
    if (bootState === "ready") void loadMyInvitations();
  }, [bootState, loadMyInvitations]);

  const visibleProjects = projects.filter((p) => p.status !== "archived");
  const navItems = currentUser?.role === "admin" ? [...primaryNav, adminNav] : primaryNav;

  return (
    <aside className={cn("flex h-full w-sidebar shrink-0 flex-col border-r border-line bg-canvas", className)} aria-label="Primary">
      <div className="flex h-topbar items-center gap-2.5 px-5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg" aria-hidden>
          <CheckSquare className="size-4" strokeWidth={2.5} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-ink">Scope Checklist</span>
      </div>

      <nav className="px-3 pt-1" aria-label="Main">
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
                    isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
                {to === routes.invitations() && pendingInvitations > 0 && (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular text-accent-fg" aria-label={`${pendingInvitations} pending`}>
                    {pendingInvitations}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex items-center justify-between px-5">
        <h2 className="text-[11px] font-semibold tracking-wider text-ink-faint uppercase">Projects</h2>
        <button
          type="button"
          onClick={() => navigate(routes.projects())}
          aria-label="New project"
          className="-mr-1.5 flex size-6 items-center justify-center rounded-md text-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>

      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 scrollbar-thin" aria-label="Projects">
        {bootState !== "ready" ? (
          <div className="space-y-2 px-2.5 pt-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2 py-1.5">
                <Skeleton className="h-3.5 w-[75%]" />
                <Skeleton className="h-1 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {visibleProjects.map((project) => {
              const active = project.uuid === projectUuid;
              return (
                <li key={project.uuid}>
                  <NavLink
                    to={routes.project(project.uuid)}
                    onClick={() => setActiveProject(project.uuid)}
                    className={cn(
                      "group block rounded-lg px-2.5 py-2 transition-colors",
                      active ? "bg-surface border border-line" : "border border-transparent hover:bg-surface-muted",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-[13px] font-medium", active ? "text-ink" : "text-ink-muted group-hover:text-ink")}>{project.name}</span>
                      <span className="shrink-0 text-[11px] tabular text-ink-faint">{project.stats.completionPercent}%</span>
                    </div>
                    <ProgressBar value={project.stats.completionPercent} size="sm" className="mt-1.5" label={`${project.name} completion`} />
                  </NavLink>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-line p-3">
        <NavLink
          to={routes.profile()}
          className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-2 py-2 transition-colors", isActive ? "bg-surface border border-line" : "hover:bg-surface-muted")}
        >
          {currentUser ? (
            <>
              <MemberAvatar user={currentUser} size="sm" plain />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{currentUser.name}</span>
                <span className="block truncate text-xs text-ink-faint">{currentUser.email}</span>
              </span>
            </>
          ) : (
            <>
              <Skeleton className="size-7 rounded-full" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-32" />
              </span>
            </>
          )}
        </NavLink>
      </div>
    </aside>
  );
}
