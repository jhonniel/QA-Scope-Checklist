import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { SECTION_KIND_LABELS, type ChecklistSection, type SectionKind, type UpdateSectionInput } from "@scope/contracts";
import { BottomSheet, Button, ConfirmDialog, Input, SegmentedControl, Textarea } from "@/design-system";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";

export interface EditSectionSheetProps {
  section: ChecklistSection | null;
  /** Tasks currently in the section — shown in the delete confirmation. */
  taskCount: number;
  /** The last remaining section of a project cannot be deleted. */
  isLastSection: boolean;
  open: boolean;
  onClose: () => void;
  /** Called after a successful delete (e.g. to leave the section page). */
  onDeleted?: () => void;
}

/** Rename a checklist section, edit its description, or delete it with its tasks. */
export function EditSectionSheet({ section, taskCount, isLastSection, open, onClose, onDeleted }: EditSectionSheetProps) {
  const updateSection = useAppStore((s) => s.updateSection);
  const deleteSection = useAppStore((s) => s.deleteSection);
  const { submitting, error, fieldErrors, run, clearField, setError } = useFormSubmit();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<SectionKind>("scope");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** What the user calls this thing — "scope" or "revision" — following the stored kind, not the unsaved switch. */
  const noun = SECTION_KIND_LABELS[section?.kind ?? "scope"].toLowerCase();

  useEffect(() => {
    if (!open || !section) return;
    setTitle(section.title);
    setDescription(section.description ?? "");
    setKind(section.kind);
    setError(null);
    setDeleteError(null);
  }, [open, section, setError]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!section) return;
    if (!title.trim()) {
      setError(`Enter a ${noun} title.`);
      return;
    }
    const input: UpdateSectionInput = {};
    if (title.trim() !== section.title) input.title = title.trim();
    if ((description.trim() || null) !== section.description) input.description = description.trim() || null;
    if (kind !== section.kind) input.kind = kind;
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    const ok = await run(async () => {
      await updateSection(section.uuid, input);
    });
    if (ok) onClose();
  };

  const remove = async () => {
    if (!section) return;
    setDeleteError(null);
    try {
      await deleteSection(section.uuid);
      onClose();
      onDeleted?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : `The ${noun} could not be deleted.`);
      throw err;
    }
  };

  return (
    <>
      <BottomSheet
        open={open}
        onClose={close}
        title={`Edit ${noun}`}
        snapPoints={[0.9]}
        desktop="dialog"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" type="submit" form="edit-section-form" loading={submitting}>
              Save
            </Button>
          </div>
        }
      >
        <form id="edit-section-form" onSubmit={submit} className="flex flex-col gap-4 pt-1" noValidate>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Type</p>
            <SegmentedControl
              value={kind}
              onChange={setKind}
              options={[
                { value: "scope", label: SECTION_KIND_LABELS.scope },
                { value: "revision", label: SECTION_KIND_LABELS.revision },
              ]}
              ariaLabel="Type"
              layoutId="edit-section-kind"
            />
            <p className="mt-1.5 text-xs text-ink-faint">Revisions are listed in their own block of the exported document, with a separate progress chart.</p>
          </div>
          <Input
            label="Title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              clearField("title");
            }}
            required
            data-autofocus
            error={fieldErrors.title ?? (error && !title.trim() ? error : undefined)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearField("description");
            }}
            placeholder={`Optional — what belongs in this ${noun}?`}
            error={fieldErrors.description}
          />
          {error && title.trim() && <FormAlert>{error}</FormAlert>}

          <div className="mt-2 rounded-xl border border-danger/20 bg-danger-soft/40 p-4">
            <h3 className="text-sm font-semibold text-ink">Delete {noun}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {isLastSection ? "A project needs at least one scope or revision, so this one cannot be deleted. Rename it instead." : `Removes the ${noun} and its ${taskCount} task${taskCount === 1 ? "" : "s"}.`}
            </p>
            {deleteError && (
              <p role="alert" className="mt-2 text-xs text-danger">
                {deleteError}
              </p>
            )}
            <Button variant="danger" size="sm" className="mt-3" leadingIcon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setConfirmDelete(true)} disabled={submitting || isLastSection}>
              Delete {noun}
            </Button>
          </div>
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        destructive
        title={`Delete “${section?.title ?? noun}”?`}
        description={taskCount > 0 ? `${taskCount} task${taskCount === 1 ? "" : "s"} in this ${noun} will be removed as well.` : `This ${noun} is empty.`}
        confirmLabel={`Delete ${noun}`}
      />
    </>
  );
}
