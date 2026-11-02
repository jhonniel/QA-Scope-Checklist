import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { routes } from "@/app/routes";
import { BottomSheet, Button, Input, Textarea } from "@/design-system";
import { useAppStore } from "@/store/useAppStore";

export interface CreateProjectSheetProps {
  open: boolean;
  onClose: () => void;
}

export function CreateProjectSheet({ open, onClose }: CreateProjectSheetProps) {
  const navigate = useNavigate();
  const createProject = useAppStore((s) => s.createProject);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setStartDate("");
    setDeadline("");
    setError(null);
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    if (startDate && deadline && deadline < startDate) {
      setError("The deadline must be after the start date.");
      return;
    }
    setBusy(true);
    try {
      const project = await createProject({ name, description, startDate: startDate || null, deadline: deadline || null });
      reset();
      onClose();
      navigate(routes.project(project.uuid));
    } catch {
      setError("Something went wrong. Your entries are kept — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="New project"
      description="A project holds scopes, revisions, tasks and members."
      snapPoints={[0.78, 0.94]}
      desktop="dialog"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" type="submit" form="create-project-form" loading={busy}>
            Create project
          </Button>
        </div>
      }
    >
      <form id="create-project-form" onSubmit={submit} className="flex flex-col gap-4 pt-1" noValidate>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Treasury Payment Gateway" required data-autofocus error={error && !name.trim() ? error : undefined} />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is in scope?" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} min={startDate || undefined} />
        </div>
        {error && name.trim() && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}
