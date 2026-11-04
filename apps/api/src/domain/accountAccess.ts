import { DomainError } from "./errors.ts";

/** Why an otherwise valid account cannot sign in, or null when it can. */
export function signInBlockReason(user: { disabled_at: string | null; approved_at: string | null }): "disabled" | "pending" | null {
  if (user.disabled_at) return "disabled";
  if (!user.approved_at) return "pending";
  return null;
}

export function signInBlockError(reason: "disabled" | "pending"): DomainError {
  if (reason === "disabled") {
    return new DomainError(403, "account_disabled", "This account has been disabled. Contact an administrator.");
  }
  return new DomainError(403, "account_pending", "This account is waiting for an administrator to approve it.");
}
