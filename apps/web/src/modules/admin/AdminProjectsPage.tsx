import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Archive, ArchiveRestore, ArrowUpRight, FolderKanban, RotateCcw, Trash2 } from "lucide-react";
import type { AdminProject, AdminProjectStatusFilter } from "@scope/contracts";
import { routes } from "@/app/routes";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { AvatarStack, Badge, Button, Card, ConfirmDialog, EmptyState, Pagination, ProgressBar, SearchInput, SegmentedControl, Skeleton } from "@/design-system";
import { formatRelative, formatShortDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/services/api";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { ProjectStatusBadge } from "@/modules/projects/ProjectStatusBadge";
import { useAppStore } from "@/store/useAppStore";
import { useDebouncedValue, useListParams, usePagedQuery } from "./usePagedQuery";

const PER_PAGE = 25;
const FILTERS = ["status"] as const;
const STATUSES: AdminProjectStatusFilter[] = ["all", "active", "completed", "archived", "deleted"];
const isStatus = (v: string): v is AdminProjectStatusFilter => (STATUSES as string[]).includes(v);

type Confirm = { kind: "archive" | "unarchive" | "delete" | "restore"; project: AdminProject };

/**
 * Registry of every project in the system, including soft-deleted ones.
 * Archive/unarchive and delete reuse the regular project endpoints (admins
 * pass the owner check); restore is admin-only.
 */
export function AdminProjectsPage() {
  const [query, setQuery] = useSearchQuery();
  const search = useDebouncedValue(query.trim(), 300);
  const { page, values, update } = useListParams(FILTERS);
  const status: AdminProjectStatusFilter = isStatus(values.status) ? values.status : "all";
  const updateProject = useAppStore((s) => s.updateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const upsertProject = useAppStore((s) => s.upsertProject);

  const load = useCallback(() => api.adminListProjects({ search: search || undefined, status, page, perPage: PER_PAGE }), [search, status, page]);
  const { result, loading, error, reload, replaceItem } = usePagedQuery(load, `projects:${search}:${status}:${page}`);
  const items = result?.items ?? [];

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (project: AdminProject, action: () => Promise<void>) => {
    setActionError(null);
    setBusy(project.uuid);
    try {
      await action();
    } catch (err) {
      setActionError(ApiError.message(err));
    } finally {
      setBusy(null);
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    const { kind, project } = confirm;
    switch (kind) {
      case "archive":
      case "unarchive": {
        const next = kind === "archive" ? "archived" : "active";
        await act(project, async () => {
          const updated = await updateProject(project.uuid, { status: next });
          replaceItem((p) => p.uuid === project.uuid, { ...updated, deletedAt: null });
        });
        break;
      }
      case "delete":
        await act(project, async () => {
          await deleteProject(project.uuid);
          reload();
        });
        break;
      case "restore":
        await act(project, async () => {
          const restored = await api.adminRestoreProject(project.uuid);
          upsertProject(restored);
          reload();
        });
        break;
    }
  };

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
          <SegmentedControl<AdminProjectStatusFilter>
            layoutId="admin-projects-status"
            ariaLabel="Filter projects"
            value={status}
            onChange={(v) => update({ status: v })}
            options={[
              { value: "all", label: "All live" },
              { value: "active", label: "Active" },
              { value: "completed", label: "Completed" },
              { value: "archived", label: "Archived" },
              { value: "deleted", label: "Deleted" },
            ]}
          />
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search project or owner" className="md:hidden" aria-label="Search projects" />
      </div>

      {actionError && <FormAlert className="mt-4">{actionError}</FormAlert>}

      <Card className="mt-4" padded={false}>
        {error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : loading && items.length === 0 ? (
          <ul aria-busy="true" aria-label="Loading projects" className="divide-y divide-line">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="space-y-2.5 px-4 py-4">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72" />
                <Skeleton className="h-1 w-full" />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState
            icon={status === "deleted" ? <Trash2 /> : <FolderKanban />}
            title={search ? "No projects match" : status === "deleted" ? "Nothing in the bin" : "No projects"}
            description={search ? "Try another project or owner name." : status === "deleted" ? "Deleted projects appear here and can be restored." : "Nobody has created a project in this state."}
            compact
          />
        ) : (
          <ul className={cn("divide-y divide-line transition-opacity", loading && "opacity-60")}>
            {items.map((p) => {
              const deleted = p.deletedAt !== null;
              const rowBusy = busy === p.uuid;
              return (
                <li key={p.uuid} className="px-4 py-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {deleted ? (
                          <span className="truncate text-sm font-medium text-ink-muted line-through decoration-line-strong">{p.name}</span>
                        ) : (
                          <Link to={routes.project(p.uuid)} className="truncate text-sm font-medium text-ink hover:underline hover:decoration-line-strong hover:underline-offset-4">
                            {p.name}
                          </Link>
                        )}
                        {deleted ? <Badge tone="danger">Deleted {formatRelative(p.deletedAt!)}</Badge> : <ProjectStatusBadge status={p.status} />}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                        <span>Owner {p.owner.name}</span>
                        <span aria-hidden>·</span>
                        <span className="tabular">
                          {p.stats.completedTasks}/{p.stats.totalTasks} tasks · {p.stats.sectionCount} {p.stats.sectionCount === 1 ? "section" : "sections"}
                        </span>
                        {p.deadline && (
                          <>
                            <span aria-hidden>·</span>
                            <span>Due {formatShortDate(p.deadline)}</span>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <span>Updated {formatRelative(p.updatedAt)}</span>
                      </p>
                      {!deleted && <ProgressBar value={p.stats.completionPercent} size="sm" className="mt-2.5 max-w-md" label={`${p.name} completion`} />}
                    </div>

                    <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                      <AvatarStack users={p.members.map((m) => m.user)} max={4} size="xs" />
                      <div className="flex items-center gap-1">
                        {deleted ? (
                          <Button variant="accent-soft" size="sm" leadingIcon={<RotateCcw className="size-3.5" aria-hidden />} loading={rowBusy} onClick={() => setConfirm({ kind: "restore", project: p })}>
                            Restore
                          </Button>
                        ) : (
                          <>
                            <Link
                              to={routes.project(p.uuid)}
                              aria-label={`Open ${p.name}`}
                              className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                            >
                              <ArrowUpRight className="size-4" aria-hidden />
                            </Link>
                            {p.status === "archived" ? (
                              <Button variant="ghost" size="icon-sm" aria-label={`Unarchive ${p.name}`} disabled={rowBusy} onClick={() => setConfirm({ kind: "unarchive", project: p })}>
                                <ArchiveRestore className="size-4" aria-hidden />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon-sm" aria-label={`Archive ${p.name}`} disabled={rowBusy} onClick={() => setConfirm({ kind: "archive", project: p })}>
                                <Archive className="size-4" aria-hidden />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} disabled={rowBusy} className="hover:bg-danger-soft hover:text-danger" onClick={() => setConfirm({ kind: "delete", project: p })}>
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {result && result.total > 0 && (
          <Pagination page={page} totalPages={result.totalPages} total={result.total} perPage={PER_PAGE} busy={loading} onChange={(p) => update({ page: p })} className="border-t border-line px-4 py-3" />
        )}
      </Card>

      <ConfirmDialog
        open={confirm?.kind === "archive"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        title={confirm ? `Archive “${confirm.project.name}”?` : ""}
        description="Members keep read access; the project leaves the sidebar and dashboards. You can unarchive it later."
        confirmLabel="Archive"
      />
      <ConfirmDialog
        open={confirm?.kind === "unarchive"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        title={confirm ? `Reactivate “${confirm.project.name}”?` : ""}
        description="The project becomes active again for every member."
        confirmLabel="Reactivate"
      />
      <ConfirmDialog
        open={confirm?.kind === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        destructive
        title={confirm ? `Delete “${confirm.project.name}”?` : ""}
        description="The project disappears for every member. Nothing is erased — it moves to the Deleted list and can be restored from here."
        confirmLabel="Delete project"
      />
      <ConfirmDialog
        open={confirm?.kind === "restore"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        title={confirm ? `Restore “${confirm.project.name}”?` : ""}
        description="The project, its checklist, members and history become visible again exactly as they were."
        confirmLabel="Restore project"
      />
    </>
  );
}
