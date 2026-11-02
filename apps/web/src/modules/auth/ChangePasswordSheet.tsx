import { useEffect, useState } from "react";
import { BottomSheet, Button, Input } from "@/design-system";
import { useAppStore } from "@/store/useAppStore";
import { FormAlert } from "./AuthLayout";
import { useFormSubmit } from "./useFormSubmit";

const MIN_PASSWORD = 8;

interface ChangePasswordSheetProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Change the signed-in user's password. Other sessions are revoked by the server. */
export function ChangePasswordSheet({ open, onClose, onChanged }: ChangePasswordSheetProps) {
  const changePassword = useAppStore((s) => s.changePassword);
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touchedConfirm, setTouchedConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setTouchedConfirm(false);
    }
  }, [open]);

  const mismatch = touchedConfirm && confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouchedConfirm(true);
    if (!canSubmit) return;
    const ok = await run(() => changePassword({ currentPassword: current, newPassword: next }));
    if (ok) {
      onChanged();
      onClose();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Change password"
      description="You stay signed in here; every other device is signed out."
      desktop="dialog"
      desktopWidthClassName="max-w-md"
      snapPoints={[0.78]}
    >
      <form id="change-password-form" onSubmit={onSubmit} noValidate className="space-y-4 pb-2">
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            clearField("currentPassword");
          }}
          error={fieldErrors.currentPassword}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            clearField("newPassword");
          }}
          error={fieldErrors.newPassword}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onBlur={() => setTouchedConfirm(true)}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? "Passwords do not match." : undefined}
        />
        <div className="flex gap-2 pt-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" className="flex-1" loading={submitting} disabled={!canSubmit}>
            Update password
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
