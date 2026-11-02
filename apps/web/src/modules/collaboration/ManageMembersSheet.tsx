import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Crown, LogOut, Mail, MoreHorizontal, UserMinus, X } from "lucide-react";
import type { Project, ProjectInvitation, ProjectMember, ProjectMemberRole } from "@scope/contracts";
import { routes } from "@/app/routes";
import { Badge, BottomSheet, Button, ConfirmDialog, Input, MemberAvatar, Select } from "@/design-system";
import { formatRelative, formatShortDate } from "@/lib/date";
import { canLeaveProject, canManageMembers } from "@/lib/permissions";
import { ApiError } from "@/services/api";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";

const roleLabel: Record<ProjectMemberRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

type Confirm = { kind: "remove"; member: ProjectMember } | { kind: "transfer"; member: ProjectMember } | { kind: "leave" } | { kind: "revoke"; invitation: ProjectInvitation };

/**
 * Member management sheet.
 *
 * Owners and admins invite people by e-mail, change roles, remove members,
 * transfer ownership and revoke pending invitations. Other members see the
 * roster and can leave the project. Every action is enforced again by the API.
 */
export function ManageMembersSheet({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const invitations = useAppStore((s) => s.invitationsByProject[project.uuid]);
  const loadProjectInvitations = useAppStore((s) => s.loadProjectInvitations);
  const inviteMember = useAppStore((s) => s.inviteMember);
  const revokeInvitation = useAppStore((s) => s.revokeInvitation);
  const updateMemberRole = useAppStore((s) => s.updateMemberRole);
  const removeMember = useAppStore((s) => s.removeMember);
  const transferOwnership = useAppStore((s) => s.transferOwnership);
  const leaveProject = useAppStore((s) => s.leaveProject);

  const canManage = canManageMembers(project, currentUser);
  const canLeave = canLeaveProject(project, currentUser);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<ProjectMemberRole, "owner">>("editor");
  const { submitting, error, fieldErrors, run, clearField, setError } = useFormSubmit();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setActionError(null);
    setError(null);
    if (canManage) void loadProjectInvitations(project.uuid).catch(() => undefined);
  }, [open, canManage, project.uuid, loadProjectInvitations, setError]);

  const pending = useMemo(() => (invitations ?? []).filter((i) => i.status === "pending"), [invitations]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("Enter a valid e-mail address.");
      return;
    }
    const ok = await run(async () => {
      await inviteMember(project.uuid, { email: value, role });
    });
    if (ok) setEmail("");
  };

  const act = async (memberUuid: string | null, action: () => Promise<void>) => {
    setActionError(null);
    setBusyMember(memberUuid);
    try {
      await action();
    } catch (err) {
      setActionError(ApiError.message(err));
      throw err;
    } finally {
      setBusyMember(null);
    }
  };

  const changeRole = (member: ProjectMember, next: Exclude<ProjectMemberRole, "owner">) => {
    if (member.role === next) return;
    void act(member.uuid, () => updateMemberRole(project.uuid, member.uuid, next)).catch(() => undefined);
  };

  const onConfirm = async () => {
    if (!confirm) return;
    switch (confirm.kind) {
      case "remove":
        await act(confirm.member.uuid, () => removeMember(project.uuid, confirm.member.uuid));
        break;
      case "transfer":
        await act(confirm.member.uuid, () => transferOwnership(project.uuid, confirm.member.uuid));
        break;
      case "revoke":
        await act(null, () => revokeInvitation(project.uuid, confirm.invitation.uuid));
        break;
      case "leave":
        await act(null, () => leaveProject(project.uuid));
        onClose();
        navigate(routes.projects(), { replace: true });
        break;
    }
  };

  const emailError = fieldErrors.email ?? (error && !fieldErrors.email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? error : undefined);
  const people = project.members.length + pending.length;

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Project members"
        description={`${project.members.length} ${project.members.length === 1 ? "person has" : "people have"} access${pending.length ? ` · ${pending.length} pending` : ""}`}
        snapPoints={[people > 5 ? 0.94 : 0.8]}
        desktop="panel"
        footer={
          canLeave ? (
            <Button variant="ghost" className="w-full text-danger hover:bg-danger-soft hover:text-danger" leadingIcon={<LogOut className="size-4" aria-hidden />} onClick={() => setConfirm({ kind: "leave" })}>
              Leave project
            </Button>
          ) : undefined
        }
      >
        {canManage && (
          <form onSubmit={invite} className="rounded-xl border border-line bg-surface-muted/60 p-3" noValidate>
            <p className="mb-2 text-xs font-medium text-ink-muted">Invite by e-mail</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearField("email");
                  if (error) setError(null);
                }}
                placeholder="name@company.com"
                aria-label="E-mail address"
                wrapperClassName="flex-1"
                error={emailError}
                inputMode="email"
                autoComplete="off"
                disabled={submitting}
              />
              <div className="flex gap-2">
                <Select value={role} onChange={(e) => setRole(e.target.value as "editor" | "viewer")} aria-label="Role" wrapperClassName="w-28" disabled={submitting}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </Select>
                <Button type="submit" variant="primary" leadingIcon={<Mail className="size-4" aria-hidden />} loading={submitting}>
                  Invite
                </Button>
              </div>
            </div>
            {error && !emailError && <FormAlert className="mt-2">{error}</FormAlert>}
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">They receive a link by e-mail; people without an account register with that address first. Editors can change tasks, viewers can read and comment.</p>
          </form>
        )}

        {actionError && <FormAlert className="mt-4">{actionError}</FormAlert>}

        <ul className="mt-4 divide-y divide-line">
          {project.members.map((m) => {
            const isSelf = m.user.uuid === currentUser?.uuid;
            const busy = busyMember === m.uuid;
            const manageable = canManage && m.role !== "owner" && !isSelf;
            return (
              <li key={m.uuid} className="flex items-center gap-3 py-3">
                <MemberAvatar user={m.user} size="md" plain />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {m.user.name}
                    {isSelf && <span className="ml-1.5 text-xs font-normal text-ink-faint">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-ink-muted">{m.user.email}</p>
                </div>
                {manageable ? (
                  <div className="flex items-center gap-1.5">
                    <Select value={m.role} onChange={(e) => changeRole(m, e.target.value as "editor" | "viewer")} aria-label={`Role of ${m.user.name}`} wrapperClassName="w-26" className="h-8 text-xs" disabled={busy}>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                    <MemberMenu member={m} disabled={busy} onTransfer={() => setConfirm({ kind: "transfer", member: m })} onRemove={() => setConfirm({ kind: "remove", member: m })} />
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-0.5">
                    <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{roleLabel[m.role]}</Badge>
                    <span className="text-[11px] text-ink-faint">since {formatShortDate(m.joinedAt)}</span>
                  </div>
                )}
              </li>
            );
          })}

          {canManage &&
            pending.map((i) => (
              <li key={i.uuid} className="flex items-center gap-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-faint" aria-hidden>
                  <Mail className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{i.email}</p>
                  <p className="truncate text-xs text-ink-muted">
                    Invited {formatRelative(i.createdAt)} by {i.invitedBy.name}
                  </p>
                </div>
                <Badge tone="outline">{roleLabel[i.role]}</Badge>
                <Button variant="ghost" size="icon-sm" aria-label={`Revoke invitation for ${i.email}`} onClick={() => setConfirm({ kind: "revoke", invitation: i })} disabled={busyMember !== null}>
                  <X className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
        </ul>

        {canManage && invitations && pending.length === 0 && project.members.length === 1 && (
          <p className="mt-2 text-center text-xs text-ink-faint">You are the only member so far. Invite someone above.</p>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        destructive
        title={confirm?.kind === "remove" ? `Remove ${confirm.member.user.name}?` : ""}
        description="They lose access to this project immediately. Their past checks and comments stay in the history."
        confirmLabel="Remove member"
      />
      <ConfirmDialog
        open={confirm?.kind === "transfer"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        title={confirm?.kind === "transfer" ? `Make ${confirm.member.user.name} the owner?` : ""}
        description="They gain full control of the project, including membership and deletion. The current owner becomes an editor."
        confirmLabel="Transfer ownership"
      />
      <ConfirmDialog
        open={confirm?.kind === "revoke"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        destructive
        title={confirm?.kind === "revoke" ? `Revoke the invitation for ${confirm.invitation.email}?` : ""}
        description="The e-mailed link stops working. You can invite them again later."
        confirmLabel="Revoke"
      />
      <ConfirmDialog
        open={confirm?.kind === "leave"}
        onClose={() => setConfirm(null)}
        onConfirm={onConfirm}
        destructive
        title={`Leave “${project.name}”?`}
        description="You lose access until someone invites you again. Your checks and comments remain in the project history."
        confirmLabel="Leave project"
      />
    </>
  );
}

/** Overflow actions for a manageable member (transfer ownership / remove). */
function MemberMenu({ member, disabled, onTransfer, onRemove }: { member: ProjectMember; disabled?: boolean; onTransfer: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="relative">
      <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${member.user.name}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="size-4" aria-hidden />
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-muted" onClick={() => (setOpen(false), onTransfer())}>
            <Crown className="size-4 text-ink-muted" aria-hidden /> Make owner
          </button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-soft" onClick={() => (setOpen(false), onRemove())}>
            <UserMinus className="size-4" aria-hidden /> Remove from project
          </button>
        </div>
      )}
    </div>
  );
}

export { roleLabel };
