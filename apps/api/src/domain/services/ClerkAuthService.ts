import type { Database } from "../../db/database.ts";
import { toUser, type UserRow } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { RequestMeta, ResolvedSession } from "./AuthService.ts";
import type { ClerkDirectory } from "./ClerkDirectory.ts";
import { hashToken } from "./password.ts";

/**
 * Placeholder stored in `password_hash` for accounts created through Clerk.
 * It is not a scrypt hash, so `verifyPassword` can never accept it — the
 * built-in login stays closed to these accounts even if the provider is
 * switched back to `session` (an administrator would send a reset link).
 */
export const CLERK_MANAGED_PASSWORD = "clerk-managed";

export type ClerkResolution = ResolvedSession | { problem: "account_disabled" | "unknown_identity" };

export interface ClerkAuthServiceOptions {
  /** Mirror rows in `sessions` live this long without being seen (same as the cookie TTL). */
  sessionTtlMs: number;
}

/**
 * Maps a verified Clerk session to a local account. The first request of a
 * Clerk session creates a mirror row in `sessions` so "last seen", the admin
 * session list and "revoke sessions" keep working exactly as before; later
 * requests only touch it. Roles, memberships and every authorization rule
 * stay local — Clerk answers *who*, this application decides *what*.
 */
export class ClerkAuthService {
  constructor(
    private readonly db: Database,
    private readonly directory: ClerkDirectory,
    private readonly options: ClerkAuthServiceOptions,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.options.sessionTtlMs);
  }

  /** Mirror rows are keyed by the Clerk session id; prefixed so they can never collide with cookie tokens. */
  static mirrorTokenHash(clerkSessionId: string): string {
    return hashToken(`clerk:${clerkSessionId}`);
  }

  async resolve(identity: { clerkUserId: string; clerkSessionId: string }, meta: RequestMeta): Promise<ClerkResolution> {
    const repos = repositories(this.db);
    const tokenHash = ClerkAuthService.mirrorTokenHash(identity.clerkSessionId);

    const existing = await repos.sessions.findActive(tokenHash);
    // Defence in depth: a mirror row must belong to the same Clerk user the token names.
    if (existing && existing.user.clerk_user_id !== identity.clerkUserId) await repos.sessions.deleteById(existing.id);
    else if (existing) {
      if (existing.user.disabled_at) return { problem: "account_disabled" };
      const lastSeen = new Date(`${String(existing.last_seen_at).replace(" ", "T")}Z`).getTime();
      if (Date.now() - lastSeen > 5 * 60_000) await repos.sessions.touch(existing.id, this.expiry());
      return ClerkAuthService.context(existing.id, existing.user);
    }

    const user = await this.findOrProvisionUser(identity.clerkUserId);
    if (!user) return { problem: "unknown_identity" };
    if (user.disabled_at) return { problem: "account_disabled" };
    const sessionId = await repos.sessions.create({ tokenHash, userId: user.id, ip: meta.ip, userAgent: meta.userAgent, expiresAt: this.expiry() });
    return ClerkAuthService.context(sessionId, user);
  }

  /**
   * Local account for a Clerk user: already linked → as is; same e-mail → link
   * it (this is how imported and pre-existing accounts come across); otherwise
   * a new account with the default role, mirroring what `/auth/register` did.
   */
  private async findOrProvisionUser(clerkUserId: string): Promise<UserRow | null> {
    const repos = repositories(this.db);
    const linked = await repos.users.findByClerkUserId(clerkUserId);
    if (linked) return linked;

    const identity = await this.directory.getUser(clerkUserId);
    if (!identity?.email) return null;

    const byEmail = await repos.users.findByEmail(identity.email);
    if (byEmail) {
      await repos.users.linkClerkUser(byEmail.id, clerkUserId);
      return (await repos.users.findById(byEmail.id))!;
    }
    return repos.users.create({
      name: identity.name ?? identity.email.split("@")[0],
      email: identity.email,
      passwordHash: CLERK_MANAGED_PASSWORD,
      clerkUserId,
    });
  }

  /** Drop the mirror row for the current request's Clerk session (sign-out). */
  async endSession(sessionId: number): Promise<void> {
    await repositories(this.db).sessions.deleteById(sessionId);
  }

  /** Admin actions call this alongside deleting the local mirror rows so the Clerk session itself ends too. */
  async revokeClerkSessions(user: Pick<UserRow, "clerk_user_id">): Promise<void> {
    if (user.clerk_user_id) await this.directory.revokeSessions(user.clerk_user_id);
  }

  private static context(sessionId: number, user: UserRow): ResolvedSession {
    return {
      sessionId,
      actor: { id: user.id, uuid: user.uuid, role: user.role === "admin" ? "admin" : "user" },
      user: toUser(user),
    };
  }
}
