import type { ProjectStatus } from "@scope/contracts";
import { Badge } from "@/design-system";

const config: Record<ProjectStatus, { label: string; tone: "accent" | "success" | "neutral" }> = {
  active: { label: "Active", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const { label, tone } = config[status];
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}

export const projectStatusLabel = (status: ProjectStatus) => config[status].label;
