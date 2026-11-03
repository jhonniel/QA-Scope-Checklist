import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/design-system";

export interface PhaseGroupHeaderProps {
  title: string;
  /** e.g. "2 scopes · 1 revision" — what this phase currently holds. */
  meta?: string;
  canEdit: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}

/** Heading for a phase container — edit, reorder, or delete (scopes and revisions stay). */
export function PhaseGroupHeader({ title, meta, canEdit, onMoveUp, onMoveDown, onEdit, onDelete }: PhaseGroupHeaderProps) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
        {meta && <p className="mt-0.5 text-xs text-ink-muted">{meta}</p>}
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={onMoveUp} disabled={!onMoveUp} aria-label="Move phase up">
            <ChevronUp className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onMoveDown} disabled={!onMoveDown} aria-label="Move phase down">
            <ChevronDown className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${title}`}>
            <Pencil className="size-3.5" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Delete ${title}`}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
