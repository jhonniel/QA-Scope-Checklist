import type { Request } from "express";
import type { User } from "@scope/contracts";
import { DomainError, UnauthorizedError } from "../domain/errors.ts";
import type { Actor } from "../domain/models.ts";
import type { AuthService } from "../domain/services/AuthService.ts";
import type { ProjectService } from "../domain/services/ProjectService.ts";
import type { ChecklistService } from "../domain/services/ChecklistService.ts";
import type { ActivityService } from "../domain/services/ActivityService.ts";
import type { MembershipService } from "../domain/services/MembershipService.ts";
import type { ExportService } from "../domain/services/ExportService.ts";
import type { AdminService } from "../domain/services/AdminService.ts";
import type { ErrorLogService } from "../domain/services/ErrorLogService.ts";
import type { ClerkAuthService } from "../domain/services/ClerkAuthService.ts";

/** Services wired once at startup and handed to the controllers. */
export interface Services {
  auth: AuthService;
  /** Present only when `AUTH_PROVIDER=clerk`. */
  clerkAuth: ClerkAuthService | null;
  projects: ProjectService;
  checklist: ChecklistService;
  activity: ActivityService;
  membership: MembershipService;
  exports: ExportService;
  admin: AdminService;
  errors: ErrorLogService;
}

export interface AuthContext {
  sessionId: number;
  actor: Actor;
  user: User;
}

/** Why a request that carried valid external credentials still has no `auth` (Clerk provider only). */
export type AuthProblem = "account_disabled" | "unknown_identity";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      authProblem?: AuthProblem;
    }
  }
}

/** Read the authenticated principal; throws 401 when the session middleware found none. */
export function requireAuth(req: Request): AuthContext {
  if (req.auth) return req.auth;
  if (req.authProblem === "account_disabled") throw new DomainError(401, "account_disabled", "This account has been disabled. Contact an administrator.");
  if (req.authProblem === "unknown_identity") throw new DomainError(401, "unknown_identity", "Your sign-in is valid but no account could be matched to it. Contact an administrator.");
  throw new UnauthorizedError();
}

export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}
