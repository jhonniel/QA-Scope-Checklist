import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onChange: (page: number) => void;
  /** Disable the controls while a page is loading. */
  busy?: boolean;
  className?: string;
}

/** "1–25 of 120 · Page 1 of 5" with previous/next controls, for server-paged lists. */
export function Pagination({ page, totalPages, total, perPage, onChange, busy, className }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <nav className={cn("flex items-center justify-between gap-3 text-xs text-ink-muted", className)} aria-label="Pagination">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || busy} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <span className="min-w-16 text-center tabular">
          Page {page} of {totalPages}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || busy} onClick={() => onChange(page + 1)}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
