import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { CheckSquare } from "lucide-react";
import { groupSectionsByPhase, type PublicShareSnapshot, type Task, type TaskCheckSide } from "@scope/contracts";
import { routes } from "@/app/routes";
import { Card, EmptyState, Input, ProgressBar, Skeleton, TaskRowSkeleton } from "@/design-system";
import { sectionProgress } from "@/lib/stats";
import { ApiError, api } from "@/services/api";
import { PhaseGroupFrame } from "@/modules/projects/PhaseGroupFrame";
import { PhaseGroupHeader } from "@/modules/projects/PhaseGroupHeader";
import { resolvePhaseTone } from "@/modules/projects/phaseTone";
import { ProjectStatusBadge } from "@/modules/projects/ProjectStatusBadge";
import { ChecklistSectionCard } from "@/modules/checklist/ChecklistSectionCard";
import { FormAlert } from "@/modules/auth/AuthLayout";

const GUEST_NAME_KEY = "scope-public-guest-name";

function readGuestName(): string {
  try {
    return sessionStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeGuestName(name: string): void {
  try {
    sessionStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    /* private mode */
  }
}

/** Unauthenticated project view: selected scopes, full tasks, Client ticks only. */
export function PublicSharePage() {
  const { token = "" } = useParams();
  const location = useLocation();
  const [snapshot, setSnapshot] = useState<PublicShareSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState(readGuestName);
  const [guestError, setGuestError] = useState<string | null>(null);

  useEffect(() => {
    document.title = snapshot ? `${snapshot.project.name} · Shared checklist` : "Shared checklist · Scope Checklist";
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void api
      .getPublicShare(token)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setSnapshot(null);
        setError(err instanceof ApiError ? err.message : "This shared project could not be opened.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const groups = useMemo(() => (snapshot ? groupSectionsByPhase(snapshot.sections, snapshot.phases) : []), [snapshot]);
  const tasksBySection = useMemo(() => {
    const map = new Map<string, Task[]>();
    if (!snapshot) return map;
    for (const task of snapshot.tasks) {
      const list = map.get(task.sectionUuid) ?? [];
      list.push(task);
      map.set(task.sectionUuid, list);
    }
    return map;
  }, [snapshot]);

  const applyTask = useCallback((saved: Task) => {
    setSnapshot((current) => {
      if (!current) return current;
      return { ...current, tasks: current.tasks.map((task) => (task.uuid === saved.uuid ? saved : task)) };
    });
  }, []);

  const toggleCheck = async (task: Task, side: TaskCheckSide) => {
    if (side !== "client") return;
    const name = guestName.trim();
    if (task.clientCheck === null && name.length < 2) {
      setGuestError("Enter your name before ticking Client.");
      return;
    }
    setGuestError(null);
    writeGuestName(name);
    try {
      const saved = await api.setPublicClientCheck(token, task.uuid, { clientChecked: task.clientCheck === null, guestName: name });
      applyTask(saved);
    } catch (err) {
      setGuestError(err instanceof ApiError ? err.message : "Could not update the Client check.");
    }
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to={routes.home()} className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-accent text-accent-fg" aria-hidden>
              <CheckSquare className="size-4" strokeWidth={2.5} />
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">Scope Checklist</span>
          </Link>
          <Link to={routes.login(location.pathname)} className="text-xs font-medium text-ink-muted hover:text-ink">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {error && !snapshot && (
          <EmptyState title="This link is not available" description={error} />
        )}

        {!error && !snapshot && (
          <div className="space-y-4">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-[70%]" />
            <Card padded={false}>
              <TaskRowSkeleton />
              <TaskRowSkeleton />
            </Card>
          </div>
        )}

        {snapshot && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProjectStatusBadge status={snapshot.project.status} />
              <span className="text-xs font-medium tracking-wide text-ink-faint uppercase">Shared checklist</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">{snapshot.project.name}</h1>
            {snapshot.project.description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">{snapshot.project.description}</p>}

            <Card className="mt-5 px-5 py-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-ink-muted">
                <span>
                  {snapshot.project.stats.completedTasks} of {snapshot.project.stats.totalTasks} tasks complete
                </span>
              </div>
              <ProgressBar value={snapshot.project.stats.completionPercent} label="Project completion" />
            </Card>

            <div className="mt-5 rounded-2xl border border-line bg-surface px-4 py-3">
              <Input
                label="Your name"
                value={guestName}
                onChange={(e) => {
                  setGuestName(e.target.value);
                  setGuestError(null);
                }}
                onBlur={() => writeGuestName(guestName.trim())}
                placeholder="Shown on Client checks"
                error={guestError ?? undefined}
              />
              <p className="mt-1.5 text-xs text-ink-faint">Used when you tick Client. Developer checks stay with the project team.</p>
            </div>

            {guestError && !guestName.trim() && (
              <div className="mt-3">
                <FormAlert>{guestError}</FormAlert>
              </div>
            )}

            <div className="mt-5 space-y-4">
              {snapshot.sections.length === 0 && <EmptyState title="Nothing has been shared yet" description="The project team has not chosen any scopes or revisions for this link." />}
              {groups.map((group) => {
                if (group.sections.length === 0) return null;
                const cards = group.sections.map((section) => {
                  const tasks = tasksBySection.get(section.uuid) ?? [];
                  return (
                    <ChecklistSectionCard
                      key={section.uuid}
                      section={section}
                      tasks={tasks}
                      onToggleCheck={(task, side) => void toggleCheck(task, side)}
                      onReorder={() => undefined}
                      onAdd={async () => undefined}
                      readOnly
                      allowClientCheck
                      linkToSection={false}
                      completionPercent={sectionProgress(tasks).percent}
                    />
                  );
                });
                if (!group.phase) return <div key="ungrouped" className="space-y-4">{cards}</div>;
                const tone = resolvePhaseTone(group.phase.color);
                return (
                  <PhaseGroupFrame
                    key={group.phase.uuid}
                    tone={tone}
                    label={group.phase.title}
                    header={<PhaseGroupHeader title={group.phase.title} meta={`${group.sections.length} ${group.sections.length === 1 ? "scope" : "scopes"}`} canEdit={false} onDelete={() => undefined} />}
                  >
                    {cards}
                  </PhaseGroupFrame>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
