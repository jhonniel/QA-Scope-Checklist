import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ACTIVITY_TYPES, type ActivityLog, type ActivityType, type Paginated } from "@scope/contracts";
import { routes } from "@/app/routes";
import { PageHeader } from "@/app/layout/PageHeader";
import { Button, Card, SegmentedControl, Select } from "@/design-system";
import { api, ApiError } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { ActivityFeed } from "./ActivityFeed";

const PER_PAGE = 25;
const TYPE_LABEL: Record<ActivityType, string> = { all: "All", tasks: "Tasks", checks: "Checks", comments: "Comments", members: "Members", project: "Project" };
const isType = (v: string | null): v is ActivityType => !!v && (ACTIVITY_TYPES as readonly string[]).includes(v);

/**
 * Owner-only history. Pages and filters are served by the API (never the
 * whole log) and kept in the URL so the view survives navigation.
 */
export function ActivityPage() {
  const navigate = useNavigate();
  const projects = useAppStore((s) => s.projects);
  const currentUser = useAppStore((s) => s.currentUser);
  const ownedProjects = useMemo(() => projects.filter((p) => p.owner.uuid === currentUser?.uuid), [projects, currentUser]);
  const activities = useAppStore((s) => s.activities); // used only as a change signal after local mutations
  const [params, setParams] = useSearchParams();

  const projectFilter = params.get("project") ?? "all";
  const type: ActivityType = isType(params.get("type")) ? (params.get("type") as ActivityType) : "all";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const [result, setResult] = useState<Paginated<ActivityLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const update = useCallback(
    (patch: { project?: string; type?: ActivityType; page?: number }) => {
      const next = new URLSearchParams(params);
      if (patch.project !== undefined) patch.project === "all" ? next.delete("project") : next.set("project", patch.project);
      if (patch.type !== undefined) patch.type === "all" ? next.delete("type") : next.set("type", patch.type);
      // Changing a filter restarts at the first page.
      const pageValue = patch.page ?? (patch.project !== undefined || patch.type !== undefined ? 1 : page);
      pageValue <= 1 ? next.delete("page") : next.set("page", String(pageValue));
      setParams(next, { replace: patch.page === undefined });
    },
    [params, page, setParams],
  );

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .listActivityPage({ project: projectFilter === "all" ? undefined : projectFilter, type, page, perPage: PER_PAGE })
      .then((res) => {
        if (id !== requestId.current) return;
        setResult(res);
        // Landed past the end (e.g. stale URL): snap back to the last page.
        if (res.page > res.totalPages) update({ page: res.totalPages });
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setError(ApiError.message(err));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    // `activities` is intentionally a dependency: the store refreshes it after logged mutations.
  }, [projectFilter, type, page, activities, update]);

  const projectNames = useMemo(() => Object.fromEntries(ownedProjects.map((p) => [p.uuid, p.name])), [ownedProjects]);
  const onSelect = useCallback((a: ActivityLog) => navigate(routes.project(a.projectUuid)), [navigate]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader
        title="Activity"
        description="What changed on the projects you own."
        actions={
          <Select aria-label="Filter by project" value={projectFilter} onChange={(e) => update({ project: e.target.value })} wrapperClassName="w-full sm:w-64">
            <option value="all">All owned projects</option>
            {ownedProjects.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.name}
              </option>
            ))}
          </Select>
        }
      />

      <div className="mt-5 -mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <SegmentedControl<ActivityType>
          layoutId="activity-type-filter"
          ariaLabel="Filter by kind of change"
          value={type}
          onChange={(v) => update({ type: v })}
          options={ACTIVITY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />
      </div>

      <Card className="mt-4">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => update({ page })}>
              Retry
            </Button>
          </div>
        ) : (
          <ActivityFeed
            activities={items}
            loading={loading && items.length === 0}
            limit={PER_PAGE}
            projectNames={projectNames}
            onSelect={onSelect}
            emptyText={type === "all" && projectFilter === "all" ? "No activity yet." : "Nothing matches these filters."}
            className={loading && items.length > 0 ? "opacity-60 transition-opacity" : "transition-opacity"}
          />
        )}

        {total > 0 && (
          <nav className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted" aria-label="Pagination">
            <span className="tabular">
              {from}–{to} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => update({ page: page - 1 })}>
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <span className="min-w-16 text-center tabular">
                Page {page} of {totalPages}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => update({ page: page + 1 })}>
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
