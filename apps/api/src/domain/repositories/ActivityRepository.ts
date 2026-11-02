import { randomUUID } from "node:crypto";
import type { ActivityAction } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type ActivityRow } from "../models.ts";

const SELECT = `
  SELECT a.uuid, p.uuid AS project_uuid, a.action, a.subject, a.meta, a.created_at, ${userSummaryColumns("u", "u")}
  FROM activity_logs a
  INNER JOIN projects p ON p.id = a.project_id
  INNER JOIN users u ON u.id = a.actor_id`;

export class ActivityRepository {
  constructor(private readonly db: Queryable) {}

  /** Newest first. `projectIds` scopes the feed; `null` means every project (admins). */
  list(projectIds: number[] | null, limit = 100): Promise<ActivityRow[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    if (projectIds === null) {
      return this.db.query<ActivityRow>(`${SELECT} WHERE p.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC LIMIT ${safeLimit}`);
    }
    if (projectIds.length === 0) return Promise.resolve([]);
    const params: SqlParam[] = projectIds;
    return this.db.query<ActivityRow>(
      `${SELECT} WHERE a.project_id IN (${projectIds.map(() => "?").join(", ")}) ORDER BY a.created_at DESC, a.id DESC LIMIT ${safeLimit}`,
      params,
    );
  }

  /**
   * One page of history, newest first. `actions` narrows to a set of action
   * names (undefined = everything). Returns the total for pagination.
   */
  async page(projectIds: number[] | null, options: { page: number; perPage: number; actions?: readonly ActivityAction[] }): Promise<{ rows: ActivityRow[]; total: number }> {
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (projectIds === null) {
      where.push("p.deleted_at IS NULL");
    } else {
      if (projectIds.length === 0) return { rows: [], total: 0 };
      where.push(`a.project_id IN (${projectIds.map(() => "?").join(", ")})`);
      params.push(...projectIds);
    }
    if (options.actions && options.actions.length > 0) {
      where.push(`a.action IN (${options.actions.map(() => "?").join(", ")})`);
      params.push(...options.actions);
    }
    const clause = `WHERE ${where.join(" AND ")}`;
    const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage)));
    const offset = Math.max(0, Math.floor(options.page) - 1) * perPage;

    const count = await this.db.queryOne<{ total: number | string }>(`SELECT COUNT(*) AS total FROM activity_logs a INNER JOIN projects p ON p.id = a.project_id ${clause}`, params);
    const rows = await this.db.query<ActivityRow>(`${SELECT} ${clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    return { rows, total: Number(count?.total ?? 0) };
  }

  async record(input: { projectId: number; actorId: number; action: ActivityAction; subject: string; meta?: Record<string, unknown> | null; createdAt?: string }): Promise<void> {
    await this.db.execute("INSERT INTO activity_logs (uuid, project_id, actor_id, action, subject, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      randomUUID(),
      input.projectId,
      input.actorId,
      input.action,
      input.subject.slice(0, 255),
      input.meta ? JSON.stringify(input.meta) : null,
      input.createdAt ?? nowSql(),
    ]);
  }
}
