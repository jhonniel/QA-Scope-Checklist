import { useCallback, useState } from "react";
import { ChevronRight, ShieldCheck, Users } from "lucide-react";
import type { AdminUser, AdminUserRoleFilter, AdminUserStatusFilter } from "@scope/contracts";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { Badge, Button, Card, EmptyState, MemberAvatar, Pagination, SearchInput, SegmentedControl, Select, Skeleton } from "@/design-system";
import { formatRelative, formatShortDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { api } from "@/services/api";
import { useAppStore } from "@/store/useAppStore";
import { UserDetailSheet } from "./UserDetailSheet";
import { useDebouncedValue, useListParams, usePagedQuery } from "./usePagedQuery";

const PER_PAGE = 25;
const FILTERS = ["role", "status"] as const;
const isRole = (v: string): v is AdminUserRoleFilter => v === "admin" || v === "user";
const isStatus = (v: string): v is AdminUserStatusFilter => v === "active" || v === "disabled";

/** Directory of every account with server-side search, filters and paging. */
export function AdminUsersPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const [query, setQuery] = useSearchQuery();
  const search = useDebouncedValue(query.trim(), 300);
  const { page, values, update } = useListParams(FILTERS);
  const role: AdminUserRoleFilter = isRole(values.role) ? values.role : "all";
  const status: AdminUserStatusFilter = isStatus(values.status) ? values.status : "all";
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const load = useCallback(() => api.adminListUsers({ search: search || undefined, role, status, page, perPage: PER_PAGE }), [search, role, status, page]);
  const { result, loading, error, reload, replaceItem } = usePagedQuery(load, `users:${search}:${role}:${status}:${page}`);
  const items = result?.items ?? [];

  const onUpdated = (user: AdminUser) => {
    replaceItem((u) => u.uuid === user.uuid, user);
    setSelected(user);
  };

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
          <SegmentedControl<AdminUserStatusFilter>
            layoutId="admin-users-status"
            ariaLabel="Filter by account state"
            value={status}
            onChange={(v) => update({ status: v })}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Enabled" },
              { value: "disabled", label: "Disabled" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name or e-mail" className="flex-1 md:hidden" aria-label="Search users" />
          <Select aria-label="Filter by role" value={role} onChange={(e) => update({ role: e.target.value })} wrapperClassName="w-36 shrink-0">
            <option value="all">All roles</option>
            <option value="admin">Administrators</option>
            <option value="user">Users</option>
          </Select>
        </div>
      </div>

      <Card className="mt-4" padded={false}>
        {error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : loading && items.length === 0 ? (
          <ul aria-busy="true" aria-label="Loading users" className="divide-y divide-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-9 rounded-full" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-56" />
                </span>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState icon={<Users />} title={search ? "No accounts match" : "No accounts"} description={search ? "Try another name or e-mail, or clear the filters." : "Nobody matches these filters."} compact />
        ) : (
          <ul className={cn("divide-y divide-line transition-opacity", loading && "opacity-60")}>
            {items.map((u) => {
              const isSelf = u.uuid === currentUser?.uuid;
              return (
                <li key={u.uuid}>
                  <button
                    type="button"
                    onClick={() => setSelected(u)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                    aria-label={`Manage ${u.name}`}
                  >
                    <MemberAvatar user={u} size="md" plain className={cn(u.disabledAt && "opacity-50 grayscale")} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={cn("truncate text-sm font-medium", u.disabledAt ? "text-ink-muted line-through decoration-line-strong" : "text-ink")}>{u.name}</span>
                        {isSelf && <span className="text-xs text-ink-faint">(you)</span>}
                        {u.role === "admin" && (
                          <Badge tone="accent">
                            <ShieldCheck className="size-3" aria-hidden /> Admin
                          </Badge>
                        )}
                        {u.disabledAt && <Badge tone="danger">Disabled</Badge>}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">{u.email}</span>
                    </span>
                    <span className="hidden shrink-0 flex-col items-end text-xs text-ink-faint sm:flex">
                      <span className="tabular">
                        {u.ownedProjects} owned · {u.memberships} {u.memberships === 1 ? "project" : "projects"}
                      </span>
                      <span>{u.lastSeenAt ? `Active ${formatRelative(u.lastSeenAt)}` : `Joined ${formatShortDate(u.createdAt)}`}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {result && result.total > 0 && (
          <Pagination page={page} totalPages={result.totalPages} total={result.total} perPage={PER_PAGE} busy={loading} onChange={(p) => update({ page: p })} className="border-t border-line px-4 py-3" />
        )}
      </Card>

      <UserDetailSheet user={selected} open={selected !== null} onClose={() => setSelected(null)} onUpdated={onUpdated} onChanged={reload} />
    </>
  );
}
