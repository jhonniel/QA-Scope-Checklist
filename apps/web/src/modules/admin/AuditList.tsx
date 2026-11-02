import { Link } from "react-router";
import type { AdminAuditEntry } from "@scope/contracts";
import { routes } from "@/app/routes";
import { MemberAvatar, Skeleton } from "@/design-system";
import { formatRelative } from "@/lib/date";
import { cn } from "@/lib/cn";
import { describeAudit } from "./adminLabels";

/** Compact list of administrative actions (newest first). */
export function AuditList({ entries, loading, compact, emptyText = "No administrative actions recorded yet.", className }: { entries: AdminAuditEntry[]; loading?: boolean; compact?: boolean; emptyText?: string; className?: string }) {
  if (loading && entries.length === 0) {
    return (
      <ul className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading audit log">
        {Array.from({ length: compact ? 4 : 6 }).map((_, i) => (
          <li key={i} className="flex items-start gap-3">
            <Skeleton className="mt-0.5 size-8 rounded-full" />
            <span className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-3 w-[70%]" />
              <Skeleton className="h-2.5 w-[35%]" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (entries.length === 0) return <p className={cn("py-6 text-center text-sm text-ink-faint", className)}>{emptyText}</p>;

  return (
    <ol className={cn(compact ? "space-y-3" : "divide-y divide-line", className)}>
      {entries.map((e) => (
        <li key={e.uuid} className={cn("flex items-start gap-3", !compact && "py-3 first:pt-0 last:pb-0")}>
          <MemberAvatar user={e.actor} size="sm" plain className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-5 text-ink">
              <span className="font-medium">{e.actor.name}</span>
              <span className="text-ink-muted"> {describeAudit(e)}</span>
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
              {e.targetType === "project" ? (
                <Link to={routes.project(e.targetUuid)} className="hover:text-ink hover:underline">
                  Open project
                </Link>
              ) : (
                <Link to={`${routes.adminUsers()}?q=${encodeURIComponent(e.subject)}`} className="hover:text-ink hover:underline">
                  View account
                </Link>
              )}
              <span aria-hidden>·</span>
              <time dateTime={e.createdAt}>{formatRelative(e.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
