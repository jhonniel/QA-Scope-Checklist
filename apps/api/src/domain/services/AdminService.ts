import type {
  AdminAuditEntry,
  AdminProductivity,
  AdminProductivityPeriod,
  AdminProductivityQuery,
  AdminProject,
  AdminProjectQuery,
  AdminStats,
  AdminUpdateUserInput,
  AdminUser,
  AdminUserQuery,
  PageQuery,
  Paginated,
  ProductivityWeights,
} from "@scope/contracts";
import { PRODUCTIVITY_WEIGHTS, productivityScore } from "@scope/contracts";
import type { Database, Queryable } from "../../db/database.ts";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "../errors.ts";
import { toAdminAudit, toAdminProject, toAdminUser, toMember, toStats, type Actor, type AdminUserRow, type ProjectRow } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { AuthService } from "./AuthService.ts";

const todayIso = () => new Date().toISOString().slice(0, 10);

const PERIOD_DAYS: Record<AdminProductivityPeriod, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };

export interface AdminServiceOptions {
  /** Points per activity bucket; defaults to the shared `PRODUCTIVITY_WEIGHTS`. */
  productivityWeights: ProductivityWeights;
  /**
   * Ends the user's sessions at the external identity provider too (Clerk).
   * Called after the local session rows are deleted; absent under the built-in session auth.
   */
  revokeExternalSessions?: (user: Pick<AdminUserRow, "clerk_user_id">) => Promise<void>;
  /** When true, local passwords cannot be set (AUTH_PROVIDER=clerk). */
  passwordsManagedExternally?: boolean;
}

/**
 * System administration: directory of accounts, registry of every project
 * (including soft-deleted ones), system statistics and the admin audit trail.
 * Every method requires the `admin` system role; none of them bypasses the
 * project-level rules — admins already pass `ProjectService.accessFor`.
 */
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    private readonly options: AdminServiceOptions = { productivityWeights: PRODUCTIVITY_WEIGHTS },
  ) {}

  /** Guard shared by every admin endpoint. */
  static assertAdmin(actor: Actor): void {
    if (actor.role !== "admin") throw new ForbiddenError("Administrator access is required.");
  }

  // ---- overview -----------------------------------------------------------

  async stats(actor: Actor): Promise<AdminStats> {
    AdminService.assertAdmin(actor);
    const now = new Date();
    return { ...(await repositories(this.db).stats.systemStats(now)), generatedAt: now.toISOString() };
  }

  /** Who gets things done: every account ranked by weighted activity over the period. */
  async productivity(actor: Actor, query: AdminProductivityQuery): Promise<AdminProductivity> {
    AdminService.assertAdmin(actor);
    const now = new Date();
    const period = query.period ?? "30d";
    const days = PERIOD_DAYS[period];
    const since = days === null ? null : new Date(now.getTime() - days * 86_400_000);

    const weights = this.options.productivityWeights;
    const entries = (await repositories(this.db).stats.productivity(since)).map((e) => ({ ...e, score: productivityScore(e.counts, weights) }));
    entries.sort((a, b) => b.score - a.score || b.totalActions - a.totalActions || a.user.name.localeCompare(b.user.name));

    return {
      period,
      since: since ? since.toISOString() : null,
      entries,
      totals: {
        actions: entries.reduce((sum, e) => sum + e.totalActions, 0),
        score: entries.reduce((sum, e) => sum + e.score, 0),
        activeUsers: entries.filter((e) => e.totalActions > 0).length,
      },
      weights,
      generatedAt: now.toISOString(),
    };
  }

  // ---- users --------------------------------------------------------------

  async listUsers(actor: Actor, query: AdminUserQuery): Promise<Paginated<AdminUser>> {
    AdminService.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const { rows, total } = await repositories(this.db).users.page({ page, perPage, search: query.search?.trim() || undefined, role: query.role, status: query.status });
    return { items: rows.map(toAdminUser), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /** Edit name, e-mail and/or system role. Self-demotion and demoting the last administrator are refused. */
  async updateUser(actor: Actor, userUuid: string, input: AdminUpdateUserInput): Promise<AdminUser> {
    AdminService.assertAdmin(actor);
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const user = await this.requireUser(userUuid, tx);

      if (input.email !== undefined) {
        const existing = await repos.users.findByEmail(input.email);
        if (existing && existing.id !== user.id) throw new ConflictError("That email is already in use.", [{ field: "email", message: "Already in use." }]);
      }

      const roleChanged = input.role !== undefined && input.role !== user.role;
      if (roleChanged) {
        if (user.id === actor.id) throw new ConflictError("You cannot change your own role.");
        if (user.role === "admin" && !user.disabled_at && (await repos.users.countActiveAdmins()) <= 1) {
          throw new ConflictError("At least one enabled administrator is required.");
        }
      }

      const detailsChanged = (input.name !== undefined && input.name.trim() !== user.name) || (input.email !== undefined && input.email.toLowerCase() !== user.email);
      if (detailsChanged) await repos.users.updateProfile(user.id, { name: input.name, email: input.email });
      if (roleChanged) await repos.users.updateRole(user.id, input.role!);

      const updated = (await repos.users.findAdminByUuid(userUuid))!;
      if (detailsChanged) {
        await repos.adminAudit.record({ actorId: actor.id, action: "user.updated", targetType: "user", targetUuid: user.uuid, subject: updated.name, meta: { fields: Object.keys(input).filter((k) => k !== "role") } });
      }
      if (roleChanged) {
        await repos.adminAudit.record({ actorId: actor.id, action: "user.role_changed", targetType: "user", targetUuid: user.uuid, subject: updated.name, meta: { from: user.role, to: input.role } });
      }
      return toAdminUser(updated);
    });
  }

  /** Disable: the account keeps every record but cannot sign in; its sessions are revoked immediately. */
  async setUserDisabled(actor: Actor, userUuid: string, disabled: boolean): Promise<AdminUser> {
    AdminService.assertAdmin(actor);
    const result = await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const user = await this.requireUser(userUuid, tx);
      if (disabled) {
        if (user.id === actor.id) throw new ConflictError("You cannot disable your own account.");
        if (user.role === "admin" && !user.disabled_at && (await repos.users.countActiveAdmins()) <= 1) {
          throw new ConflictError("At least one enabled administrator is required.");
        }
      }
      const changed = Boolean(user.disabled_at) !== disabled;
      if (changed) {
        await repos.users.setDisabled(user.id, disabled);
        if (disabled) await repos.sessions.deleteAllForUser(user.id);
        await repos.adminAudit.record({ actorId: actor.id, action: disabled ? "user.disabled" : "user.enabled", targetType: "user", targetUuid: user.uuid, subject: user.name });
      }
      return { user, changed, updated: toAdminUser((await repos.users.findAdminByUuid(userUuid))!) };
    });
    // Outside the transaction: a slow or failing identity provider must not roll back the local change.
    if (disabled && result.changed) await this.options.revokeExternalSessions?.(result.user);
    return result.updated;
  }

  /** Allow a self-registered account to sign in. Idempotent if already approved. */
  async approveUser(actor: Actor, userUuid: string): Promise<AdminUser> {
    AdminService.assertAdmin(actor);
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const user = await this.requireUser(userUuid, tx);
      if (!user.approved_at) {
        await repos.users.setApproved(user.id);
        await repos.adminAudit.record({ actorId: actor.id, action: "user.approved", targetType: "user", targetUuid: user.uuid, subject: user.name });
      }
      return toAdminUser((await repos.users.findAdminByUuid(userUuid))!);
    });
  }

  /** Sign the account out of every device. The acting admin's own current session is kept. */
  async revokeUserSessions(actor: Actor, sessionId: number, userUuid: string): Promise<void> {
    AdminService.assertAdmin(actor);
    const user = await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const user = await this.requireUser(userUuid, tx);
      await repos.sessions.deleteAllForUser(user.id, user.id === actor.id ? sessionId : undefined);
      await repos.adminAudit.record({ actorId: actor.id, action: "user.sessions_revoked", targetType: "user", targetUuid: user.uuid, subject: user.name });
      return user;
    });
    // Revoking one's own sessions keeps the current one locally; at Clerk every session ends, so skip self.
    if (user.id !== actor.id) await this.options.revokeExternalSessions?.(user);
  }

  /**
   * Set a new password for any account, including the administrator's own.
   * Other devices are signed out; the acting admin's current session is kept when it is their account.
   */
  async setUserPassword(actor: Actor, sessionId: number, userUuid: string, password: string): Promise<void> {
    AdminService.assertAdmin(actor);
    if (this.options.passwordsManagedExternally) {
      throw new DomainError(409, "auth_managed_externally", "Sign-in and passwords are managed by Clerk for this deployment.");
    }
    const user = await this.requireUser(userUuid);
    if (user.disabled_at) throw new ConflictError("Enable the account before changing the password.");
    await this.auth.setPassword(user.id, password, user.id === actor.id ? sessionId : undefined);
    await repositories(this.db).adminAudit.record({ actorId: actor.id, action: "user.password_changed", targetType: "user", targetUuid: user.uuid, subject: user.name });
  }

  /** E-mail the account a password-reset link. Refused for disabled accounts (they cannot sign in anyway). */
  async sendPasswordReset(actor: Actor, userUuid: string): Promise<void> {
    AdminService.assertAdmin(actor);
    const user = await this.requireUser(userUuid);
    if (user.disabled_at) throw new ConflictError("Enable the account before sending a password reset.");
    if (!user.approved_at) throw new ConflictError("Approve the account before sending a password reset.");
    await this.auth.sendPasswordReset(user);
    await repositories(this.db).adminAudit.record({ actorId: actor.id, action: "user.password_reset_sent", targetType: "user", targetUuid: user.uuid, subject: user.name });
  }

  // ---- projects -----------------------------------------------------------

  async listProjects(actor: Actor, query: AdminProjectQuery): Promise<Paginated<AdminProject>> {
    AdminService.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const { rows, total } = await repositories(this.db).projects.pageAll({ page, perPage, search: query.search?.trim() || undefined, status: query.status });
    return { items: await this.hydrate(rows), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /** Undo a soft delete. Logged both in the project's own history and in the admin trail. */
  async restoreProject(actor: Actor, projectUuid: string): Promise<AdminProject> {
    AdminService.assertAdmin(actor);
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const project = await repos.projects.findByUuidIncludingDeleted(projectUuid);
      if (!project) throw new NotFoundError("Project");
      if (!project.deleted_at) throw new ConflictError("This project is not deleted.");
      await repos.projects.restore(project.id);
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.restored", subject: project.name });
      await repos.adminAudit.record({ actorId: actor.id, action: "project.restored", targetType: "project", targetUuid: project.uuid, subject: project.name });
      const restored = (await repos.projects.findByUuidIncludingDeleted(projectUuid))!;
      return (await this.hydrate([restored], tx))[0];
    });
  }

  // ---- audit --------------------------------------------------------------

  async listAudit(actor: Actor, query: PageQuery): Promise<Paginated<AdminAuditEntry>> {
    AdminService.assertAdmin(actor);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const { rows, total } = await repositories(this.db).adminAudit.page({ page, perPage });
    return { items: rows.map(toAdminAudit), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  // ---- helpers ------------------------------------------------------------

  private async requireUser(userUuid: string, q: Queryable = this.db): Promise<AdminUserRow> {
    const user = await repositories(q).users.findAdminByUuid(userUuid);
    if (!user) throw new NotFoundError("User");
    return user;
  }

  /** Same shape as `ProjectService.hydrate`, plus `deletedAt`. */
  private async hydrate(rows: ProjectRow[], q: Queryable = this.db): Promise<AdminProject[]> {
    if (rows.length === 0) return [];
    const repos = repositories(q);
    const ids = rows.map((r) => r.id);
    const [members, stats] = await Promise.all([repos.projects.membersFor(ids), repos.projects.statsFor(ids, todayIso())]);
    const membersByProject = new Map<number, ReturnType<typeof toMember>[]>();
    for (const m of members) {
      const list = membersByProject.get(Number(m.project_id)) ?? [];
      list.push(toMember(m));
      membersByProject.set(Number(m.project_id), list);
    }
    return rows.map((row) => toAdminProject(row, membersByProject.get(row.id) ?? [], toStats(stats.get(row.id))));
  }
}
