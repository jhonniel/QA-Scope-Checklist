import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { Project } from "@scope/contracts";
import { Badge, BentoCard, Button, MemberAvatar } from "@/design-system";
import { ManageMembersSheet, roleLabel } from "./ManageMembersSheet";

export function MembersCard({ project, cols = 1, rows = 1 }: { project: Project; cols?: 1 | 2; rows?: 1 | 2 }) {
  const [open, setOpen] = useState(false);
  const members = project.members;

  return (
    <BentoCard
      cols={cols}
      rows={rows}
      label="Members"
      action={
        <Button variant="ghost" size="icon-sm" aria-label="Manage members" onClick={() => setOpen(true)}>
          <UserPlus className="size-4" aria-hidden />
        </Button>
      }
    >
      <ul className="flex flex-col gap-2.5">
        {members.slice(0, rows === 2 ? 8 : 4).map((m) => (
          <li key={m.uuid} className="flex items-center gap-2.5">
            <MemberAvatar user={m.user} size="sm" plain />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{m.user.name}</p>
            </div>
            <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{roleLabel[m.role]}</Badge>
          </li>
        ))}
      </ul>
      {members.length > (rows === 2 ? 8 : 4) && (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 self-start text-xs font-medium text-ink-muted hover:text-ink">
          View all {members.length}
        </button>
      )}
      <ManageMembersSheet project={project} open={open} onClose={() => setOpen(false)} />
    </BentoCard>
  );
}

export { roleLabel };
