import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, LogOut, ShieldCheck, UserRoundCheck, UserRoundX } from "lucide-react";
import type { AdminUser, SystemRole } from "@scope/contracts";
import { Badge, BottomSheet, Button, ConfirmDialog, Input, MemberAvatar, Select } from "@/design-system";
import { formatDateTime, formatLongDate } from "@/lib/date";
import { api, ApiError } from "@/services/api";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";
import { SYSTEM_ROLE_LABEL } from "./adminLabels";

type Confirm = "disable" | "enable" | "revoke" | "reset" | "promote" | "demote";

interface Props {
  user: AdminUser | null;
  open: boolean;
  onClose: () => void;
  /** The server's refreshed copy after any change. */
  onUpdated: (user: AdminUser) => void;
  /** Fired after actions that do not return a user (e.g. revoking sessions) so the list can refresh. */
  onChanged?: () => void;
}

/**
 * Account management for one user: details, system role, enable/disable,
 * forced sign-out and password-reset link. Every rule (no self-demotion,
 * last administrator, disabled accounts) is enforced again by the API.
 */
export function UserDetailSheet({ user, open, onClose, onUpdated, onChanged }: Props) {
  const currentUser = useAppStore((s) => s.currentUser);
  const patchCurrentUser = useAppStore((s) => s.patchCurrentUser);
  const isSelf = user?.uuid === currentUser?.uuid;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SystemRole>("user");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { submitting, error, fieldErrors, run, clearField, setError } = useFormSubmit();

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setRole(user.role);
  }, [user]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setActionError(null);
    setError(null);
  }, [open, setError]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!user) return null;

  const dirty = name.trim() !== user.name || email.trim().toLowerCase() !== user.email;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    const ok = await run(async () => {
      const input: { name?: string; email?: string } = {};
      if (name.trim() !== user.name) input.name = name.trim();
      if (email.trim().toLowerCase() !== user.email) input.email = email.trim().toLowerCase();
      const updated = await api.adminUpdateUser(user.uuid, input);
      onUpdated(updated);
      if (isSelf) patchCurrentUser({ name: updated.name, email: updated.email });
    });
    if (ok) setNotice("Account details saved.");
  };

  /** Runs an action; the result (success notice or API error) is shown inside the sheet and the confirm dialog always closes. */
  const act = async (action: () => Promise<void>, done: string): Promise<boolean> => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      setNotice(done);
      return true;
    } catch (err) {
      setActionError(ApiError.message(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onRoleChange = (next: SystemRole) => {
    if (next === user.role) return;
    setRole(next);
    setConfirm(next === "admin" ? "promote" : "demote");
  };

  const onConfirm = async () => {
    switch (confirm) {
      case "promote":
      case "demote": {
        const ok = await act(async () => onUpdated(await api.adminUpdateUser(user.uuid, { role })), `${user.name} is now ${role === "admin" ? "an administrator" : "a regular user"}.`);
        if (!ok) setRole(user.role);
        break;
      }
      case "disable":
        await act(async () => onUpdated(await api.adminSetUserDisabled(user.uuid, true)), "Account disabled and signed out everywhere.");
        break;
      case "enable":
        await act(async () => onUpdated(await api.adminSetUserDisabled(user.uuid, false)), "Account re-enabled.");
        break;
      case "revoke":
        await act(async () => {
          await api.adminRevokeUserSessions(user.uuid);
          onChanged?.();
        }, "Signed out of every device.");
        break;
      case "reset":
        await act(() => api.adminSendPasswordReset(user.uuid), `A reset link was e-mailed to ${user.email}.`);
        break;
    }
  };

  const disabled = user.disabledAt !== null;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Manage account"
        description={isSelf ? "This is your own account." : disabled ? "Disabled — cannot sign in." : `${SYSTEM_ROLE_LABEL[user.role]} since ${formatLongDate(user.createdAt)}`}
        snapPoints={[0.94]}
        desktop="panel"
      >
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted/60 p-3">
          <MemberAvatar user={user} size="lg" plain />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {user.role === "admin" && (
              <Badge tone="accent">
                <ShieldCheck className="size-3" aria-hidden /> Admin
              </Badge>
            )}
            {disabled && <Badge tone="danger">Disabled</Badge>}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-line p-2.5">
            <dt className="text-ink-faint">Owns</dt>
            <dd className="mt-0.5 font-semibold tabular text-ink">
              {user.ownedProjects} {user.ownedProjects === 1 ? "project" : "projects"}
            </dd>
          </div>
          <div className="rounded-lg border border-line p-2.5">
            <dt className="text-ink-faint">Member of</dt>
            <dd className="mt-0.5 font-semibold tabular text-ink">
              {user.memberships} {user.memberships === 1 ? "project" : "projects"}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg border border-line p-2.5">
            <dt className="text-ink-faint">Last active</dt>
            <dd className="mt-0.5 truncate font-semibold text-ink">{user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "No session"}</dd>
          </div>
        </dl>

        {(notice || actionError) && <div className="mt-4">{actionError ? <FormAlert>{actionError}</FormAlert> : <FormAlert tone="success">{notice}</FormAlert>}</div>}

        <form className="mt-5 space-y-3" onSubmit={save} noValidate>
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Details</h3>
          {error && <FormAlert>{error}</FormAlert>}
          <Input
            label="Full name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearField("name");
            }}
            error={fieldErrors.name}
            autoComplete="off"
          />
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearField("email");
            }}
            error={fieldErrors.email}
            inputMode="email"
            autoComplete="off"
          />
          <Button type="submit" variant="primary" size="sm" loading={submitting} disabled={!dirty}>
            Save details
          </Button>
        </form>

        <div className="mt-6 space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">System role</h3>
          <Select value={role} onChange={(e) => onRoleChange(e.target.value as SystemRole)} disabled={isSelf || busy} aria-label="System role" hint={isSelf ? "You cannot change your own role." : "Administrators see every project and manage accounts."}>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </Select>
        </div>

        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Access</h3>
          <ActionRow
            icon={<KeyRound className="size-4" aria-hidden />}
            title="Send password-reset link"
            description={disabled ? "Enable the account first." : "E-mails a single-use link that expires in 60 minutes."}
            action="Send"
            disabled={busy || disabled}
            onClick={() => setConfirm("reset")}
          />
          <ActionRow
            icon={<LogOut className="size-4" aria-hidden />}
            title="Sign out everywhere"
            description={isSelf ? "Ends your other sessions; this one stays." : "Ends every active session for this account."}
            action="Sign out"
            disabled={busy}
            onClick={() => setConfirm("revoke")}
          />
          {disabled ? (
            <ActionRow icon={<UserRoundCheck className="size-4" aria-hidden />} title="Re-enable account" description="They can sign in again with their existing password." action="Enable" disabled={busy} onClick={() => setConfirm("enable")} />
          ) : (
            <ActionRow
              icon={<UserRoundX className="size-4" aria-hidden />}
              title="Disable account"
              description={isSelf ? "You cannot disable your own account." : "Blocks sign-in and ends their sessions. Projects, checks and history are kept."}
              action="Disable"
              destructive
              disabled={busy || isSelf}
              onClick={() => setConfirm("disable")}
            />
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirm === "promote" || confirm === "demote"}
        onClose={() => {
          setConfirm(null);
          setRole(user.role);
        }}
        onConfirm={onConfirm}
        title={confirm === "promote" ? `Make ${user.name} an administrator?` : `Remove administrator rights from ${user.name}?`}
        description={confirm === "promote" ? "Administrators can open every project, manage all accounts and change roles." : "They keep their projects and memberships but lose access to the administration area."}
        confirmLabel={confirm === "promote" ? "Make administrator" : "Remove rights"}
      />
      <ConfirmDialog
        open={confirm === "disable"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        destructive
        title={`Disable ${user.name}?`}
        description="They are signed out immediately and cannot sign in until re-enabled. Nothing they created is removed."
        confirmLabel="Disable account"
      />
      <ConfirmDialog open={confirm === "enable"} onClose={() => setConfirm(null)} onConfirm={onConfirm} title={`Re-enable ${user.name}?`} description="They can sign in again right away." confirmLabel="Enable account" />
      <ConfirmDialog
        open={confirm === "revoke"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        title={`Sign ${isSelf ? "yourself" : user.name} out everywhere?`}
        description={isSelf ? "Every other device is signed out; you stay signed in here." : "Every device is signed out; they can sign in again with their password."}
        confirmLabel="Sign out"
      />
      <ConfirmDialog open={confirm === "reset"} onClose={() => setConfirm(null)} onConfirm={onConfirm} title={`Send a reset link to ${user.email}?`} description="The link is single-use and expires in 60 minutes. Their current password keeps working until they use it." confirmLabel="Send link" />
    </>
  );
}

function ActionRow({ icon, title, description, action, destructive, disabled, onClick }: { icon: ReactNode; title: string; description: string; action: string; destructive?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-3">
      <span className={destructive ? "text-danger" : "text-ink-muted"}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{description}</p>
      </div>
      <Button variant={destructive ? "danger" : "secondary"} size="sm" disabled={disabled} onClick={onClick}>
        {action}
      </Button>
    </div>
  );
}
