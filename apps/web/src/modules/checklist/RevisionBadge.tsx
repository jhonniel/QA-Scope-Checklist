import type { ChecklistSection } from "@scope/contracts";
import { revisionAsOf } from "@scope/contracts";
import { formatLongDate } from "@/lib/date";
import { Badge } from "@/design-system";

/** The wording printed beside a revision, here and in the exported document. */
export function revisionLabel(section: Pick<ChecklistSection, "kind" | "revisionDate" | "completedAt">): string | null {
  if (section.kind !== "revision") return null;
  const asOf = revisionAsOf(section);
  return asOf ? `Revision as of ${formatLongDate(asOf)}` : "Revision";
}

/**
 * Marks a revision section beside its title. "Revision as of July 17, 2026"
 * when a date is picked (or the section finished without one); "Revision"
 * until then.
 */
export function RevisionBadge({ section, className }: { section: Pick<ChecklistSection, "kind" | "revisionDate" | "completedAt">; className?: string }) {
  const label = revisionLabel(section);
  if (!label) return null;
  return (
    <Badge tone={section.completedAt ? "success" : "warning"} className={className}>
      {label}
    </Badge>
  );
}
