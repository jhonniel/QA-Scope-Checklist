import type { ChecklistSection } from "@scope/contracts";
import { formatLongDate } from "@/lib/date";
import { Badge } from "@/design-system";

/** The wording printed beside a finished revision, here and in the exported document. */
export function revisionLabel(section: Pick<ChecklistSection, "kind" | "completedAt">): string | null {
  if (section.kind !== "revision") return null;
  return section.completedAt ? `Revision as of ${formatLongDate(section.completedAt)}` : "Revision";
}

/**
 * Marks a revision section beside its title. While work is open it reads
 * "Revision"; once every task is resolved it carries the completion date the
 * server stamped — "Revision as of July 17, 2026" — so each round of changes
 * stays identifiable after the next one is added.
 */
export function RevisionBadge({ section, className }: { section: Pick<ChecklistSection, "kind" | "completedAt">; className?: string }) {
  const label = revisionLabel(section);
  if (!label) return null;
  return (
    <Badge tone={section.completedAt ? "success" : "warning"} className={className}>
      {label}
    </Badge>
  );
}
