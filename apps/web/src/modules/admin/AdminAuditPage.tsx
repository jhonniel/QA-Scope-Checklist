import { useCallback } from "react";
import { Button, Card, Pagination } from "@/design-system";
import { api } from "@/services/api";
import { AuditList } from "./AuditList";
import { useListParams, usePagedQuery } from "./usePagedQuery";

const PER_PAGE = 25;

/** Every administrative action, newest first, served one page at a time. */
export function AdminAuditPage() {
  const { page, update } = useListParams([]);
  const load = useCallback(() => api.adminListAudit({ page, perPage: PER_PAGE }), [page]);
  const { result, loading, error, reload } = usePagedQuery(load, `audit:${page}`);
  const items = result?.items ?? [];

  return (
    <Card className="mt-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Audit log</h2>
          <p className="mt-0.5 text-xs text-ink-muted">Account and role changes, forced sign-outs, reset links and restores. Entries are never edited or deleted.</p>
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      ) : (
        <AuditList entries={items} loading={loading} className={loading && items.length > 0 ? "opacity-60 transition-opacity" : "transition-opacity"} />
      )}

      {result && <Pagination page={page} totalPages={result.totalPages} total={result.total} perPage={PER_PAGE} busy={loading} onChange={(p) => update({ page: p })} className="mt-4 border-t border-line pt-3" />}
    </Card>
  );
}
