import type { RegisterResult, User } from "@scope/contracts";
import type { Database } from "../../db/database.ts";
import { signInBlockError, signInBlockReason } from "../accountAccess.ts";
import { ConflictError, DomainError, TooManyRequestsError, UnauthorizedError, ValidationError } from "../errors.ts";
import { toUser, type Actor, type UserRow } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { MailService } from "./MailService.ts";
import { generateToken, hashPassword, hashToken, verifyPassword } from "./password.ts";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthSession {
  user: User;
  /** Raw token for the cookie; only ever returned once. */
  token: string;
}

export interface ResolvedSession {
  sessionId: number;
  actor: Actor;
  user: User;
}

export interface AuthServiceOptions {
  sessionTtlMs: number;
  resetTtlMs: number;
  appUrl: string;
  mail: MailService;
}

/** Simple in-memory throttle for credential guessing (per IP + email). */
class LoginThrottle {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  assertAllowed(key: string) {
    const entry = this.attempts.get(key);
    if (entry && entry.count >= this.max && entry.resetAt > Date.now()) throw new TooManyRequestsError();
  }

  recordFailure(key: string) {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count += 1;
  }

  clear(key: string) {
    this.attempts.delete(key);
  }
}

export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly db: Database,
    private readonly options: AuthServiceOptions,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.options.sessionTtlMs);
  }

  private async openSession(user: UserRow, meta: RequestMeta): Promise<AuthSession> {
    const token = generateToken();
    await repositories(this.db).sessions.create({ tokenHash: hashToken(token), userId: user.id, ip: meta.ip, userAgent: meta.userAgent, expiresAt: this.expiry() });
    return { user: toUser(user), token };
  }

  async register(input: { name: string; email: string; password: string }, meta: RequestMeta): Promise<RegisterResult & { token: string | null }> {
    const repos = repositories(this.db);
    if (await repos.users.findByEmail(input.email)) {
      throw new ConflictError("An account with this email already exists.", [{ field: "email", message: "Already registered." }]);
    }
    const passwordHash = await hashPassword(input.password);
    // Empty system: the first account must be able to approve everyone else.
    if ((await repos.users.countActiveAdmins()) === 0) {
      const user = await repos.users.create({ name: input.name, email: input.email, passwordHash, role: "admin", approved: true });
      const session = await this.openSession(user, meta);
      return { user: session.user, pendingApproval: false, token: session.token };
    }
    const user = await repos.users.create({ name: input.name, email: input.email, passwordHash, approved: false });
    return { user: toUser(user), pendingApproval: true, token: null };
  }

  async login(input: { email: string; password: string }, meta: RequestMeta): Promise<AuthSession> {
    const key = `${meta.ip ?? "?"}|${input.email.toLowerCase()}`;
    this.throttle.assertAllowed(key);

    const user = await repositories(this.db).users.findByEmail(input.email);
    const valid = user ? await verifyPassword(input.password, user.password_hash) : false;
    if (!user || !valid) {
      this.throttle.recordFailure(key);
      throw new DomainError(401, "invalid_credentials", "The email or password is incorrect.");
    }
    this.throttle.clear(key);
    // Checked after the password so a blocked account is never confirmed to a guesser.
    const blocked = signInBlockReason(user);
    if (blocked) throw signInBlockError(blocked);
    return this.openSession(user, meta);
  }

  async logout(sessionId: number): Promise<void> {
    await repositories(this.db).sessions.deleteById(sessionId);
  }

  /** Validate a cookie token. Extends the session (sliding expiry) at most every 5 minutes. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const sessions = repositories(this.db).sessions;
    const session = await sessions.findActive(hashToken(token));
    if (!session) return null;
    // Disabling revokes sessions, but a request racing that revocation must still be rejected.
    if (signInBlockReason(session.user)) return null;
    const lastSeen = new Date(`${String(session.last_seen_at).replace(" ", "T")}Z`).getTime();
    if (Date.now() - lastSeen > 5 * 60_000) await sessions.touch(session.id, this.expiry());
    return {
      sessionId: session.id,
      actor: { id: session.user.id, uuid: session.user.uuid, role: session.user.role === "admin" ? "admin" : "user" },
      user: toUser(session.user),
    };
  }

  async currentUser(actor: Actor): Promise<User> {
    const row = await repositories(this.db).users.findById(actor.id);
    if (!row) throw new UnauthorizedError();
    return toUser(row);
  }

  async updateProfile(actor: Actor, patch: { name?: string; email?: string }): Promise<User> {
    const repos = repositories(this.db);
    if (patch.email) {
      const existing = await repos.users.findByEmail(patch.email);
      if (existing && existing.id !== actor.id) throw new ConflictError("That email is already in use.", [{ field: "email", message: "Already in use." }]);
    }
    return toUser(await repos.users.updateProfile(actor.id, patch));
  }

  async changePassword(actor: Actor, sessionId: number, input: { currentPassword: string; newPassword: string }): Promise<void> {
    const repos = repositories(this.db);
    const user = await repos.users.findById(actor.id);
    if (!user) throw new UnauthorizedError();
    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new ValidationError([{ field: "currentPassword", message: "Current password is incorrect." }]);
    }
    await this.setPassword(user.id, input.newPassword, sessionId);
  }

  /** Hash and store a password; every session except `keepSessionId` is revoked. */
  async setPassword(userId: number, password: string, keepSessionId?: number): Promise<void> {
    const repos = repositories(this.db);
    await repos.users.updatePassword(userId, await hashPassword(password));
    await repos.sessions.deleteAllForUser(userId, keepSessionId);
  }

  /**
   * Always resolves successfully so the endpoint does not reveal whether an
   * email is registered. The raw token is delivered only by mail.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await repositories(this.db).users.findByEmail(email);
    if (!user || signInBlockReason(user)) return;
    await this.sendPasswordReset(user);
  }

  /** Issue a reset token for a known account and mail the link (also used by administrators). */
  async sendPasswordReset(user: UserRow): Promise<void> {
    const repos = repositories(this.db);
    const token = generateToken();
    await repos.passwordResets.create(user.id, hashToken(token), new Date(Date.now() + this.options.resetTtlMs));
    const link = `${this.options.appUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
    const minutes = Math.round(this.options.resetTtlMs / 60_000);
    await this.options.mail.send({
      to: user.email,
      subject: "Reset your Scope Checklist password",
      text: `Hi ${user.name},\n\nUse the link below to choose a new password. It expires in ${minutes} minutes.\n\n${link}\n\nIf you did not request this, you can ignore this message.`,
    });
  }

  async resetPassword(input: { token: string; password: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const reset = await repos.passwordResets.findValid(hashToken(input.token));
      if (!reset) throw new DomainError(400, "invalid_token", "This reset link is invalid or has expired.");
      await repos.users.updatePassword(reset.user_id, await hashPassword(input.password));
      await repos.passwordResets.markUsed(reset.id);
      await repos.sessions.deleteAllForUser(reset.user_id);
    });
  }
}
