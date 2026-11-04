import type { AdminAuditAction, AdminAuditEntry, SystemRole } from "@scope/contracts";

export const SYSTEM_ROLE_LABEL: Record<SystemRole, string> = { admin: "Administrator", user: "User" };

const AUDIT_VERB: Record<AdminAuditAction, string> = {
  "user.updated": "updated the account of",
  "user.role_changed": "changed the role of",
  "user.disabled": "disabled the account of",
  "user.enabled": "re-enabled the account of",
  "user.approved": "approved the account of",
  "user.sessions_revoked": "signed out every device of",
  "user.password_reset_sent": "sent a password-reset link to",
  "user.password_changed": "changed the password of",
  "project.restored": "restored the project",
};

/** "Maya Santos changed the role of Daniel Reyes to Administrator" — the actor name is rendered separately. */
export function describeAudit(entry: AdminAuditEntry): string {
  const verb = AUDIT_VERB[entry.action] ?? entry.action.replace(".", " ");
  if (entry.action === "user.role_changed") {
    const to = entry.meta?.to as SystemRole | undefined;
    return to ? `${verb} ${entry.subject} to ${SYSTEM_ROLE_LABEL[to] ?? to}` : `${verb} ${entry.subject}`;
  }
  return `${verb} ${entry.subject}`;
}
