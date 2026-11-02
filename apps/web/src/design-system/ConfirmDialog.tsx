import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Confirmation for destructive or irreversible actions. Uses the shared
 * sheet: compact bottom sheet on mobile, centered dialog on desktop.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} snapPoints={[0.42]} desktop="dialog" desktopWidthClassName="max-w-sm" hideClose>
      <div className="flex flex-col items-start gap-4 pt-2 lg:pt-0">
        {destructive && (
          <div className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden>
            <AlertTriangle className="size-5" />
          </div>
        )}
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <div className="mt-1 text-sm text-ink-muted">{description}</div>}
        </div>
        <div className="flex w-full gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} className="flex-1" onClick={handleConfirm} loading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
