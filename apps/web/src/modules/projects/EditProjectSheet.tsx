import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import type { Project, ProjectStatus, UpdateProjectInput } from "@scope/contracts";
import { routes } from "@/app/routes";
import { BottomSheet, Button, ConfirmDialog, Input, SegmentedControl, Textarea } from "@/design-system";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";

export interface EditProjectSheetProps {
  project: Project;
  open: boolean;
  onClose: () => void;
  /** Owner/admin: may change status and delete the project. */
  canManage: boolean;
}

/** Edit a project's details, lifecycle status (owner only) and delete it (owner only). */
export function EditProjectSheet({ project, open, onClose, canManage }: EditProjectSheetProps) {
  const navigate = useNavigate();
  const updateProject = useAppStore((s) => s.updateProject);
  const deleteProject = useAppStore((s) => s.deleteProject);
  const { submitting, error, fieldErrors, run, clearField, setError } = useFormSubmit();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [deadline, setDeadline] = useState(project.deadline ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Re-seed the form whenever the sheet opens (or the project changes underneath it).
  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description);
    setStartDate(project.startDate ?? "");
    setDeadline(project.deadline ?? "");
    setStatus(project.status);
    setError(null);
    setDeleteError(null);
  }, [open, project, setError]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Give the project a name.");
      return;
    }
    if (startDate && deadline && deadline < startDate) {
      setError("The deadline must be after the start date.");
      return;
    }
    const input: UpdateProjectInput = {};
    if (name.trim() !== project.name) input.name = name.trim();
    if (description.trim() !== project.description) input.description = description.trim();
    if ((startDate || null) !== project.startDate) input.startDate = startDate || null;
    if ((deadline || null) !== project.deadline) input.deadline = deadline || null;
    if (canManage && status !== project.status) input.status = status;
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    const ok = await run(async () => {
      await updateProject(project.uuid, input);
    });
    if (ok) onClose();
  };

  const remove = async () => {
    setDeleteError(null);
    try {
      await deleteProject(project.uuid);
      onClose();
      navigate(routes.projects(), { replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "The project could not be deleted.");
      throw err;
    }
  };

  return (
    <>
      <BottomSheet
        open={open}
        onClose={close}
        title="Project settings"
        description="Changes are logged in the project's activity."
        snapPoints={[0.94]}
        desktop="dialog"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" type="submit" form="edit-project-form" loading={submitting}>
              Save changes
            </Button>
          </div>
        }
      >
        <form id="edit-project-form" onSubmit={submit} className="flex flex-col gap-4 pt-1" noValidate>
          <Input
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearField("name");
            }}
            required
            data-autofocus
            error={fieldErrors.name ?? (error && name.trim().length < 2 ? error : undefined)}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearField("description");
            }}
            placeholder="What is in scope?"
            error={fieldErrors.description}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                clearField("startDate");
              }}
              error={fieldErrors.startDate}
            />
            <Input
              label="Deadline"
              type="date"
              value={deadline}
              min={startDate || undefined}
              onChange={(e) => {
                setDeadline(e.target.value);
                clearField("deadline");
              }}
              error={fieldErrors.deadline}
            />
          </div>

          {canManage && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">Status</span>
              <SegmentedControl<ProjectStatus>
                layoutId={`project-status-${project.uuid}`}
                ariaLabel="Project status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "active", label: "Active" },
                  { value: "completed", label: "Completed" },
                  { value: "archived", label: "Archived" },
                ]}
              />
              <p className="text-xs text-ink-faint">Archived projects stay readable for members and remain available for export.</p>
            </div>
          )}

          {error && name.trim().length >= 2 && <FormAlert>{error}</FormAlert>}

          {canManage && (
            <div className="mt-2 rounded-xl border border-danger/20 bg-danger-soft/40 p-4">
              <h3 className="text-sm font-semibold text-ink">Delete project</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">The project is removed from everyone's list. Its history is retained for auditing.</p>
              {deleteError && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {deleteError}
                </p>
              )}
              <Button variant="danger" size="sm" className="mt-3" leadingIcon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => setConfirmDelete(true)} disabled={submitting}>
                Delete project
              </Button>
            </div>
          )}
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        destructive
        title={`Delete “${project.name}”?`}
        description={`${project.stats.totalTasks} task${project.stats.totalTasks === 1 ? "" : "s"} across ${project.stats.sectionCount} section${project.stats.sectionCount === 1 ? "" : "s"} will be removed from every member's workspace.`}
        confirmLabel="Delete project"
      />
    </>
  );
}
