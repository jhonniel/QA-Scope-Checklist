import { randomUUID } from "node:crypto";
import type { AdminUserQuery, SystemRole } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import type { AdminUserRow, UserRow } from "../models.ts";

const COLUMNS = "id, uuid, name, email, password_hash, role, avatar_url, created_at, updated_at, deleted_at, disabled_at, clerk_user_id";
/** Same columns prefixed for joins (`u.`). */
export const USER_COLUMNS_U = COLUMNS.split(", ")
  .map((c) => `u.${c}`)
  .join(", ");

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  findById(id: number): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ? AND deleted_at IS NULL`, [id]);
  }

  findByUuid(uuid: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE uuid = ? AND deleted_at IS NULL`, [uuid]);
  }

  findByEmail(email: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email = ? AND deleted_at IS NULL`, [email.toLowerCase()]);
  }

  findByClerkUserId(clerkUserId: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(`SELECT ${COLUMNS} FROM users WHERE clerk_user_id = ? AND deleted_at IS NULL`, [clerkUserId]);
  }

  /** Accounts not yet linked to Clerk (for the import script). Deleted accounts are skipped. */
  listUnlinked(): Promise<UserRow[]> {
    return this.db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE clerk_user_id IS NULL AND deleted_at IS NULL ORDER BY id`);
  }

  async create(input: { name: string; email: string; passwordHash: string; role?: "admin" | "user"; uuid?: string; createdAt?: string; clerkUserId?: string | null }): Promise<UserRow> {
    const now = input.createdAt ?? nowSql();
    const uuid = input.uuid ?? randomUUID();
    const result = await this.db.execute(
      "INSERT INTO users (uuid, name, email, password_hash, role, avatar_url, created_at, updated_at, clerk_user_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)",
      [uuid, input.name.trim(), input.email.toLowerCase(), input.passwordHash, input.role ?? "user", now, now, input.clerkUserId ?? null],
    );
    return (await this.findById(result.insertId))!;
  }

  /** Attach a Clerk identity to an existing account (first Clerk sign-in with a matching e-mail, or the import script). */
  async linkClerkUser(id: number, clerkUserId: string): Promise<void> {
    await this.db.execute("UPDATE users SET clerk_user_id = ?, updated_at = ? WHERE id = ?", [clerkUserId, nowSql(), id]);
  }

  async updateProfile(id: number, patch: { name?: string; email?: string }): Promise<UserRow> {
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name.trim());
    }
    if (patch.email !== undefined) {
      sets.push("email = ?");
      params.push(patch.email.toLowerCase());
    }
    sets.push("updated_at = ?");
    params.push(nowSql(), id);
    await this.db.execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    return (await this.findById(id))!;
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.db.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [passwordHash, nowSql(), id]);
  }

  count(): Promise<number> {
    return this.db.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL").then((r) => Number(r?.n ?? 0));
  }

  // ---- administration -----------------------------------------------------

  async updateRole(id: number, role: SystemRole): Promise<void> {
    await this.db.execute("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [role, nowSql(), id]);
  }

  async setDisabled(id: number, disabled: boolean): Promise<void> {
    const now = nowSql();
    await this.db.execute("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?", [disabled ? now : null, now, id]);
  }

  /** Enabled administrators — used to protect the last one from demotion or disabling. */
  countActiveAdmins(): Promise<number> {
    return this.db
      .queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL AND disabled_at IS NULL")
      .then((r) => Number(r?.n ?? 0));
  }

  /** One page of the directory with per-user aggregates, newest first. */
  async page(query: Required<Pick<AdminUserQuery, "page" | "perPage">> & Pick<AdminUserQuery, "search" | "role" | "status">): Promise<{ rows: AdminUserRow[]; total: number }> {
    const where: string[] = ["u.deleted_at IS NULL"];
    const params: SqlParam[] = [];
    if (query.search) {
      const like = `%${query.search.toLowerCase()}%`;
      where.push("(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)");
      params.push(like, like);
    }
    if (query.role && query.role !== "all") {
      where.push("u.role = ?");
      params.push(query.role);
    }
    if (query.status === "active") where.push("u.disabled_at IS NULL");
    if (query.status === "disabled") where.push("u.disabled_at IS NOT NULL");
    const clause = `WHERE ${where.join(" AND ")}`;
    const perPage = Math.max(1, Math.min(100, Math.floor(query.perPage)));
    const offset = Math.max(0, Math.floor(query.page) - 1) * perPage;

    const count = await this.db.queryOne<{ total: number | string }>(`SELECT COUNT(*) AS total FROM users u ${clause}`, params);
    const rows = await this.db.query<AdminUserRow>(
      `SELECT ${USER_COLUMNS_U},
              (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
              (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id AND p.deleted_at IS NULL) AS owned_projects,
              (SELECT COUNT(*) FROM project_members m INNER JOIN projects p ON p.id = m.project_id WHERE m.user_id = u.id AND p.deleted_at IS NULL) AS memberships
       FROM users u
       ${clause}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ${perPage} OFFSET ${offset}`,
      params,
    );
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** Single directory entry (same aggregates as `page`). */
  findAdminByUuid(uuid: string): Promise<AdminUserRow | null> {
    return this.db.queryOne<AdminUserRow>(
      `SELECT ${USER_COLUMNS_U},
              (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
              (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id AND p.deleted_at IS NULL) AS owned_projects,
              (SELECT COUNT(*) FROM project_members m INNER JOIN projects p ON p.id = m.project_id WHERE m.user_id = u.id AND p.deleted_at IS NULL) AS memberships
       FROM users u
       WHERE u.uuid = ? AND u.deleted_at IS NULL`,
      [uuid],
    );
  }
}
