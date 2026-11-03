import { useEffect, useState, type FormEvent } from "react";
import { defaultPhaseColor, type Phase } from "@scope/contracts";
import { BottomSheet, Button, Input } from "@/design-system";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";
import { PhaseColorPicker } from "./PhaseColorPicker";
import { resolvePhaseTone } from "./phaseTone";

export interface PhaseSheetProps {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  /** When set, the sheet edits this phase. When null, it creates one. */
  phase: Phase | null;
  /** Preset to start with when creating. */
  defaultColor?: string;
}

/** Modal for adding or editing a phase — title and tray colour in one place. */
export function PhaseSheet({ open, onClose, projectUuid, phase, defaultColor }: PhaseSheetProps) {
  const createPhase = useAppStore((s) => s.createPhase);
  const updatePhase = useAppStore((s) => s.updatePhase);
  const { submitting, error, fieldErrors, run, clearField, setError } = useFormSubmit();
  const [title, setTitle] = useState(phase?.title ?? "");
  const [color, setColor] = useState(phase?.color ?? defaultColor ?? defaultPhaseColor(0));
  const editing = phase !== null;

  useEffect(() => {
    if (!open) return;
    setTitle(phase?.title ?? "");
    setColor(phase?.color ?? defaultColor ?? defaultPhaseColor(0));
    setError(null);
  }, [open, phase, defaultColor, setError]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Enter a phase title.");
      return;
    }
    const ok = await run(async () => {
      if (phase) {
        const input: { title?: string; color?: string } = {};
        if (title.trim() !== phase.title) input.title = title.trim();
        if (color !== phase.color) input.color = color;
        if (Object.keys(input).length > 0) await updatePhase(phase.uuid, input);
      } else {
        await createPhase(projectUuid, title.trim(), color);
      }
    });
    if (ok) onClose();
  };

  const tone = resolvePhaseTone(color);
  const previewTitle = title.trim() || "Phase title";

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={editing ? "Edit phase" : "Add phase"}
      description={editing ? "Change the name or the colour of this group." : "A phase holds scopes and revisions in one coloured group."}
      desktop="dialog"
      desktopWidthClassName="max-w-md"
      snapPoints={[0.72, 0.94]}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" className="flex-1" type="submit" form="phase-form" loading={submitting} disabled={!title.trim()}>
            {editing ? "Save" : "Add phase"}
          </Button>
        </div>
      }
    >
      <form id="phase-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-5 pt-1" noValidate>
        {error && <FormAlert>{error}</FormAlert>}
        <div className="overflow-hidden rounded-xl border-2 px-4 py-3" style={{ backgroundColor: tone.fill, borderColor: tone.line }} aria-hidden>
          <p className="text-sm font-semibold tracking-wide text-ink">{previewTitle}</p>
          <p className="mt-0.5 text-xs text-ink-muted">Preview</p>
        </div>
        <Input
          label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            clearField("title");
          }}
          placeholder="e.g. Foundation"
          required
          data-autofocus
          error={fieldErrors.title}
        />
        <PhaseColorPicker color={color} onChange={setColor} />
      </form>
    </BottomSheet>
  );
}
