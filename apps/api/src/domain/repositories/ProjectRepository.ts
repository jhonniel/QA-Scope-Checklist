import { randomUUID } from "node:crypto";
import { RESOLVED_TASK_STATUSES, type AdminProjectQuery, type ProjectMemberRole, type ProjectStatus } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type MemberRow, type ProjectRow, type StatsRow } from "../models.ts";

const PROJECT_SELECT = `
  SELECT p.id, p.uuid, p.owner_id, p.name, p.description, p.status, p.start_date, p.deadline, p.created_at, p.updated_at,
         ${userSummaryColumns("o", "o")}
  FROM projects p
  INNER JOIN users o ON o.id = p.owner_id`;

/** Same projection plus `deleted_at` — only the admin registry reads soft-deleted rows. */
const ADMIN_PROJECT_SELECT = PROJECT_SELECT.replace("p.updated_at,", "p.updated_at, p.deleted_at,");

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");
const RESOLVED_IN = `(${RESOLVED_TASK_STATUSES.map((s) => `'${s}'`).join(", ")})`;

export class ProjectRepository {
  constructor(private readonly db: Queryable) {}

  /** Projects visible to a user: every project for admins, otherwise owned or shared. */
  listVisible(userId: number, isAdmin: boolean): Promise<ProjectRow[]> {
    if (isAdmin) {
      return this.db.query<ProjectRow>(`${PROJECT_SELECT} WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`);
    }
    return this.db.query<ProjectRow>(
      `${PROJECT_SELECT}
       WHERE p.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
       ORDER BY p.updated_at DESC`,
      [userId],
    );
  }

  findByUuid(uuid: string): Promise<ProjectRow | null> {
    return this.db.queryOne<ProjectRow>(`${PROJECT_SELECT} WHERE p.uuid = ? AND p.deleted_at IS NULL`, [uuid]);
  }

  findById(id: number): Promise<ProjectRow | null> {
    return this.db.queryOne<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = ? AND p.deleted_at IS NULL`, [id]);
  }

  async create(input: { ownerId: number; name: string; description: string; status?: ProjectStatus; startDate: string | null; deadline: string | null; uuid?: string; createdAt?: string }): Promise<ProjectRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      "INSERT INTO projects (uuid, owner_id, name, description, status, start_date, deadline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.ownerId, input.name.trim(), input.description.trim(), input.status ?? "active", input.startDate, input.deadline, now, now],
    );
    return (await this.findById(result.insertId))!;
  }

  async touch(projectId: number): Promise<void> {
    await this.db.execute("UPDATE projects SET updated_at = ? WHERE id = ?", [nowSql(), projectId]);
  }

  async update(id: number, patch: { name?: string; description?: string; status?: ProjectStatus; startDate?: string | null; deadline?: string | null }): Promise<ProjectRow> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    const set = (column: string, value: SqlParam) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.name !== undefined) set("name", patch.name.trim());
    if (patch.description !== undefined) set("description", patch.description.trim());
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.startDate !== undefined) set("start_date", patch.startDate);
    if (patch.deadline !== undefined) set("deadline", patch.deadline);
    set("updated_at", nowSql());
    params.push(id);
    await this.db.execute(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`, params);
    return (await this.findById(id))!;
  }

  /** Soft delete: the row, its members and history stay for auditing; it simply disappears from every list. */
  async softDelete(id: number): Promise<void> {
    const now = nowSql();
    await this.db.execute("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
  }

  // ---- administration -----------------------------------------------------

  /** Any project by uuid, deleted or not (admin registry only). */
  findByUuidIncludingDeleted(uuid: string): Promise<ProjectRow | null> {
    return this.db.queryOne<ProjectRow>(`${ADMIN_PROJECT_SELECT} WHERE p.uuid = ?`, [uuid]);
  }

  /** Undo a soft delete. Members, tasks and history were never removed. */
  async restore(id: number): Promise<void> {
    await this.db.execute("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?", [nowSql(), id]);
  }

  /** One page of the system-wide registry; `status: "deleted"` lists soft-deleted projects. */
  async pageAll(query: Required<Pick<AdminProjectQuery, "page" | "perPage">> & Pick<AdminProjectQuery, "search" | "status">): Promise<{ rows: ProjectRow[]; total: number }> {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (query.status === "deleted") where.push("p.deleted_at IS NOT NULL");
    else {
      where.push("p.deleted_at IS NULL");
      if (query.status && query.status !== "all") {
        where.push("p.status = ?");
        params.push(query.status);
      }
    }
    if (query.search) {
      const like = `%${query.search.toLowerCase()}%`;
      where.push("(LOWER(p.name) LIKE ? OR LOWER(o.name) LIKE ?)");
      params.push(like, like);
    }
    const clause = `WHERE ${where.join(" AND ")}`;
    const perPage = Math.max(1, Math.min(100, Math.floor(query.perPage)));
    const offset = Math.max(0, Math.floor(query.page) - 1) * perPage;

    const count = await this.db.queryOne<{ total: number | string }>(`SELECT COUNT(*) AS total FROM projects p INNER JOIN users o ON o.id = p.owner_id ${clause}`, params);
    const rows = await this.db.query<ProjectRow>(`${ADMIN_PROJECT_SELECT} ${clause} ORDER BY p.updated_at DESC, p.id DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    return { rows, total: Number(count?.total ?? 0) };
  }

  // ---- membership -------------------------------------------------------

  membersFor(projectIds: number[]): Promise<MemberRow[]> {
    if (projectIds.length === 0) return Promise.resolve([]);
    return this.db.query<MemberRow>(
      `SELECT m.uuid, m.project_id, m.role, m.joined_at, ${userSummaryColumns("u", "u")}
       FROM project_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.project_id IN (${placeholders(projectIds.length)})
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at ASC`,
      projectIds,
    );
  }

  memberRole(projectId: number, userId: number): Promise<ProjectMemberRole | null> {
    return this.db
      .queryOne<{ role: string }>("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", [projectId, userId])
      .then((r) => (r ? (r.role as ProjectMemberRole) : null));
  }

  async addMember(projectId: number, userId: number, role: ProjectMemberRole, joinedAt: string = nowSql()): Promise<void> {
    await this.db.execute("INSERT INTO project_members (uuid, project_id, user_id, role, joined_at) VALUES (?, ?, ?, ?, ?)", [randomUUID(), projectId, userId, role, joinedAt]);
  }

  /** One membership row (with its user) by public uuid, scoped to the project. */
  findMemberByUuid(projectId: number, memberUuid: string): Promise<MemberRow | null> {
    return this.db.queryOne<MemberRow>(
      `SELECT m.id, m.uuid, m.project_id, m.user_id, m.role, m.joined_at, ${userSummaryColumns("u", "u")}
       FROM project_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.uuid = ?`,
      [projectId, memberUuid],
    );
  }

  findMemberByUser(projectId: number, userId: number): Promise<MemberRow | null> {
    return this.db.queryOne<MemberRow>(
      `SELECT m.id, m.uuid, m.project_id, m.user_id, m.role, m.joined_at, ${userSummaryColumns("u", "u")}
       FROM project_members m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.user_id = ?`,
      [projectId, userId],
    );
  }

  async updateMemberRole(memberId: number, role: ProjectMemberRole): Promise<void> {
    await this.db.execute("UPDATE project_members SET role = ? WHERE id = ?", [role, memberId]);
  }

  /** Membership is current state, not history; the activity log records who left or was removed. */
  async removeMember(memberId: number): Promise<void> {
    await this.db.execute("DELETE FROM project_members WHERE id = ?", [memberId]);
  }

  async setOwner(projectId: number, userId: number): Promise<void> {
    await this.db.execute("UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = ?", [userId, nowSql(), projectId]);
  }

  // ---- statistics -------------------------------------------------------

  /** Per-project counters computed in SQL, keyed by project id. */
  async statsFor(projectIds: number[], today: string): Promise<Map<number, StatsRow>> {
    if (projectIds.length === 0) return new Map();
    const params: SqlParam[] = [today, ...projectIds];
    const rows = await this.db.query<StatsRow>(
      `SELECT p.id AS project_id,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS total_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status IN ${RESOLVED_IN}) AS completed_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status NOT IN ${RESOLVED_IN} AND t.due_date IS NOT NULL AND t.due_date < ?) AS overdue_tasks,
              (SELECT COUNT(*) FROM checklist_sections s WHERE s.project_id = p.id AND s.deleted_at IS NULL) AS section_count
       FROM projects p
       WHERE p.id IN (${placeholders(projectIds.length)})`,
      params,
    );
    return new Map(rows.map((r) => [Number(r.project_id), r]));
  }
}
