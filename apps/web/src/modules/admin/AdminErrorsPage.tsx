import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Bug, ChevronRight, Globe, Server, ShieldAlert } from "lucide-react";
import type { AdminErrorLog, AdminErrorSourceFilter } from "@scope/contracts";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { routes } from "@/app/routes";
import { Badge, BottomSheet, Button, Card, EmptyState, MemberAvatar, Pagination, SearchInput, SegmentedControl, Skeleton } from "@/design-system";
import { formatDateTime, formatRelative } from "@/lib/date";
import { cn } from "@/lib/cn";
import { api } from "@/services/api";
import { useDebouncedValue, useListParams, usePagedQuery } from "./usePagedQuery";

const PER_PAGE = 25;
const FILTERS = ["source"] as const;
const isSource = (v: string): v is Exclude<AdminErrorSourceFilter, "all"> => v === "api" || v === "web";

/**
 * Failures recorded by the API (unhandled 5xx) and reported by the web app.
 * Read-only and append-only: entries are evidence, never edited or removed.
 */
export function AdminErrorsPage() {
  const [query, setQuery] = useSearchQuery();
  const search = useDebouncedValue(query.trim(), 300);
  const { page, values, update } = useListParams(FILTERS);
  const source: AdminErrorSourceFilter = isSource(values.source) ? values.source : "all";
  const [selected, setSelected] = useState<AdminErrorLog | null>(null);

  const load = useCallback(() => api.adminListErrors({ search: search || undefined, source, page, perPage: PER_PAGE }), [search, source, page]);
  const { result, loading, error, reload } = usePagedQuery(load, `errors:${search}:${source}:${page}`);
  const items = result?.items ?? [];

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
          <SegmentedControl<AdminErrorSourceFilter>
            layoutId="admin-errors-source"
            ariaLabel="Filter by source"
            value={source}
            onChange={(v) => update({ source: v })}
            options={[
              { value: "all", label: "All" },
              { value: "api", label: "API" },
              { value: "web", label: "Web app" },
            ]}
          />
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search message, code or path" className="sm:w-72 md:hidden" aria-label="Search errors" />
      </div>

      <Card className="mt-4" padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Error log</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Unhandled API failures and crashes reported by the web app, newest first. Stack traces are visible here only.</p>
          </div>
          {result && <span className="shrink-0 text-xs tabular text-ink-faint">{result.total} total</span>}
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">{error}</p>
            <Button variant="secondary" size="sm" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : loading && items.length === 0 ? (
          <ul aria-busy="true" aria-label="Loading errors" className="divide-y divide-line">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-9 rounded-full" />
                <span className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-[60%]" />
                  <Skeleton className="h-3 w-[40%]" />
                </span>
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert />}
            title={search || source !== "all" ? "No errors match" : "No errors recorded"}
            description={search || source !== "all" ? "Try another search term or clear the filters." : "Unhandled failures will appear here as they happen."}
            compact
          />
        ) : (
          <ul className={cn("divide-y divide-line transition-opacity", loading && "opacity-60")}>
            {items.map((entry) => (
              <li key={entry.uuid}>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                  aria-label={`Open error: ${entry.message}`}
                >
                  <SourceIcon source={entry.source} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-medium text-ink">{entry.message}</span>
                      {entry.status !== null && <Badge tone="danger">{entry.status}</Badge>}
                      {entry.code && <Badge tone="outline">{entry.code}</Badge>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                      {(entry.method || entry.path) && (
                        <span className="truncate font-mono">
                          {entry.method ? `${entry.method} ` : ""}
                          {entry.path}
                        </span>
                      )}
                      {entry.actor && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{entry.actor.name}</span>
                        </>
                      )}
                      <span aria-hidden>·</span>
                      <time dateTime={entry.createdAt}>{formatRelative(entry.createdAt)}</time>
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {result && result.total > 0 && (
          <Pagination page={page} totalPages={result.totalPages} total={result.total} perPage={PER_PAGE} busy={loading} onChange={(p) => update({ page: p })} className="border-t border-line px-4 py-3" />
        )}
      </Card>

      <ErrorDetailSheet entry={selected} open={selected !== null} onClose={() => setSelected(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SourceIcon({ source, className }: { source: AdminErrorLog["source"]; className?: string }) {
  const Icon = source === "api" ? Server : Globe;
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger", className)} aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

const SOURCE_LABEL: Record<AdminErrorLog["source"], string> = { api: "API", web: "Web app" };

/** Full detail for one entry: where, who, when, the stack trace and any context. */
function ErrorDetailSheet({ entry, open, onClose }: { entry: AdminErrorLog | null; open: boolean; onClose: () => void }) {
  if (!entry) return null;
  return (
    <BottomSheet open={open} onClose={onClose} title="Error details" description={`${SOURCE_LABEL[entry.source]} · ${formatDateTime(entry.createdAt)}`} snapPoints={[0.94]} desktop="panel" desktopWidthClassName="max-w-xl">
      <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft/40 p-3">
        <Bug className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <p className="min-w-0 text-sm font-medium break-words text-ink">{entry.message}</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Field label="Source">
          <span className="inline-flex items-center gap-1.5">
            {entry.source === "api" ? <Server className="size-3.5 text-ink-faint" aria-hidden /> : <Globe className="size-3.5 text-ink-faint" aria-hidden />}
            {SOURCE_LABEL[entry.source]}
          </span>
        </Field>
        <Field label={entry.source === "api" ? "Status · code" : "Error type"}>
          {entry.status !== null ? `${entry.status} · ` : ""}
          {entry.code ?? "—"}
        </Field>
        <Field label={entry.source === "api" ? "Request" : "Page"} className="col-span-2">
          <span className="font-mono text-xs break-all">
            {entry.method ? `${entry.method} ` : ""}
            {entry.path ?? "—"}
          </span>
        </Field>
        <Field label="User" className="col-span-2">
          {entry.actor ? (
            <span className="inline-flex items-center gap-2">
              <MemberAvatar user={entry.actor} size="xs" plain />
              <span>{entry.actor.name}</span>
              <Link to={`${routes.adminUsers()}?q=${encodeURIComponent(entry.actor.email)}`} className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
                View account
              </Link>
            </span>
          ) : (
            <span className="text-ink-muted">Not signed in</span>
          )}
        </Field>
        {entry.userAgent && (
          <Field label="Browser" className="col-span-2">
            <span className="text-xs break-all text-ink-muted">{entry.userAgent}</span>
          </Field>
        )}
      </dl>

      {entry.stack && (
        <section className="mt-5">
          <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">Stack trace</h3>
          <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink">{entry.stack}</pre>
        </section>
      )}

      {entry.context && Object.keys(entry.context).length > 0 && (
        <section className="mt-5">
          <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">Context</h3>
          <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink">{JSON.stringify(entry.context, null, 2)}</pre>
        </section>
      )}

      <p className="mt-5 text-xs text-ink-faint">
        Entry <span className="font-mono">{entry.uuid}</span>. Error log entries are kept for the record and cannot be edited or deleted.
      </p>
    </BottomSheet>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
