import {
  PRODUCTIVITY_BUCKETS,
  RESOLVED_TASK_STATUSES,
  TASK_STATUSES,
  productivityBucket,
  type ActivityAction,
  type AdminProductivityEntry,
  type AdminStats,
  type ProductivityBucket,
  type TaskStatus,
} from "@scope/contracts";
import type { Queryable } from "../../db/database.ts";
import { fromSqlDateTime, nowSql, toSqlDateTime } from "../../db/database.ts";
import { toUserSummary } from "../models.ts";

const RESOLVED_IN = `(${RESOLVED_TASK_STATUSES.map((s) => `'${s}'`).join(", ")})`;

/**
 * System-wide read model for the admin overview. Pure aggregate SQL — nothing
 * here is cached; the numbers are computed when the page is opened.
 */
export class StatsRepository {
  constructor(private readonly db: Queryable) {}

  async systemStats(now: Date = new Date()): Promise<Omit<AdminStats, "generatedAt">> {
    const today = now.toISOString().slice(0, 10);
    const since7d = toSqlDateTime(new Date(now.getTime() - 7 * 86_400_000));
    const since30d = toSqlDateTime(new Date(now.getTime() - 30 * 86_400_000));
    const n = (row: Record<string, unknown> | null, key: string) => Number(row?.[key] ?? 0);

    const since24h = toSqlDateTime(new Date(now.getTime() - 86_400_000));
    const [users, activeUsers, projects, tasks, byStatusRows, collaboration, exportsRow, activityRow, errorsRow] = await Promise.all([
      this.db.queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
                SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END) AS disabled,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_30d
         FROM users WHERE deleted_at IS NULL`,
        [since30d],
      ),
      this.db.queryOne("SELECT COUNT(DISTINCT s.user_id) AS n FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.last_seen_at >= ? AND s.expires_at > ? AND u.deleted_at IS NULL", [since7d, nowSql(now)]),
      this.db.queryOne(
        `SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS total,
                SUM(CASE WHEN deleted_at IS NULL AND status = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN deleted_at IS NULL AND status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN deleted_at IS NULL AND status = 'archived' THEN 1 ELSE 0 END) AS archived,
                SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted,
                SUM(CASE WHEN deleted_at IS NULL AND status = 'active' AND deadline IS NOT NULL AND deadline < ? THEN 1 ELSE 0 END) AS overdue
         FROM projects`,
        [today],
      ),
      this.db.queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.status IN ${RESOLVED_IN} THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN t.status NOT IN ${RESOLVED_IN} AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdue
         FROM tasks t INNER JOIN projects p ON p.id = t.project_id
         WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL`,
        [today],
      ),
      this.db.query<{ status: string; n: number | string }>(
        "SELECT t.status, COUNT(*) AS n FROM tasks t INNER JOIN projects p ON p.id = t.project_id WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL GROUP BY t.status",
      ),
      this.db.queryOne(
        `SELECT (SELECT COUNT(*) FROM project_members m INNER JOIN projects p ON p.id = m.project_id WHERE p.deleted_at IS NULL) AS memberships,
                (SELECT COUNT(*) FROM project_invitations i INNER JOIN projects p ON p.id = i.project_id WHERE i.status = 'pending' AND p.deleted_at IS NULL) AS pending_invitations,
                (SELECT COUNT(*) FROM task_comments c INNER JOIN tasks t ON t.id = c.task_id WHERE c.deleted_at IS NULL AND t.deleted_at IS NULL) AS comments`,
      ),
      this.db.queryOne("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_30d FROM activity_logs WHERE action = 'export.generated'", [since30d]),
      this.db.queryOne("SELECT COUNT(*) AS n FROM activity_logs WHERE created_at >= ?", [since7d]),
      this.db.queryOne("SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_7d FROM error_logs", [since24h, since7d]),
    ]);

    const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const row of byStatusRows) {
      if (row.status in byStatus) byStatus[row.status as TaskStatus] = Number(row.n);
    }

    return {
      users: { total: n(users, "total"), admins: n(users, "admins"), disabled: n(users, "disabled"), newLast30Days: n(users, "new_30d"), activeLast7Days: n(activeUsers, "n") },
      projects: { total: n(projects, "total"), active: n(projects, "active"), completed: n(projects, "completed"), archived: n(projects, "archived"), deleted: n(projects, "deleted"), overdue: n(projects, "overdue") },
      tasks: { total: n(tasks, "total"), completed: n(tasks, "completed"), overdue: n(tasks, "overdue"), byStatus },
      collaboration: { memberships: n(collaboration, "memberships"), pendingInvitations: n(collaboration, "pending_invitations"), comments: n(collaboration, "comments") },
      exports: { total: n(exportsRow, "total"), last30Days: n(exportsRow, "last_30d") },
      activity: { last7Days: n(activityRow, "n") },
      errors: { total: n(errorsRow, "total"), last24Hours: n(errorsRow, "last_24h"), last7Days: n(errorsRow, "last_7d") },
    };
  }

  /**
   * Per-account contribution derived from `activity_logs` since `since`
   * (every record when null). Every non-deleted account is returned, including
   * those with no activity, unsorted and unscored — the service applies the
   * configured weights and ranks them.
   *
   * Status changes are bucketed by `meta.to`; the few rows involved are read
   * and classified here rather than with dialect-specific JSON SQL.
   */
  async productivity(since: Date | null): Promise<Omit<AdminProductivityEntry, "score">[]> {
    const where = since ? "WHERE created_at >= ?" : "";
    const params = since ? [toSqlDateTime(since)] : [];

    const [users, perAction, statusChanges, perActor] = await Promise.all([
      this.db.query<{ id: number; uuid: string; name: string; email: string; avatar_url: string | null; disabled_at: unknown }>(
        "SELECT id, uuid, name, email, avatar_url, disabled_at FROM users WHERE deleted_at IS NULL",
      ),
      this.db.query<{ actor_id: number; action: string; n: number | string }>(`SELECT actor_id, action, COUNT(*) AS n FROM activity_logs ${where} GROUP BY actor_id, action`, params),
      this.db.query<{ actor_id: number; meta: unknown }>(`SELECT actor_id, meta FROM activity_logs ${where ? `${where} AND` : "WHERE"} action = 'task.status_changed'`, params),
      this.db.query<{ actor_id: number; days: number | string; projects: number | string; last_at: unknown }>(
        // CAST … AS CHAR: PostgreSQL will not SUBSTR a TIMESTAMP directly; MySQL and SQLite accept the cast as a no-op.
        `SELECT actor_id, COUNT(DISTINCT SUBSTR(CAST(created_at AS CHAR(19)), 1, 10)) AS days, COUNT(DISTINCT project_id) AS projects, MAX(created_at) AS last_at
         FROM activity_logs ${where} GROUP BY actor_id`,
        params,
      ),
    ]);

    const emptyCounts = (): Record<ProductivityBucket, number> => Object.fromEntries(PRODUCTIVITY_BUCKETS.map((k) => [k, 0])) as Record<ProductivityBucket, number>;
    const counts = new Map<number, Record<ProductivityBucket, number>>();
    const totals = new Map<number, number>();
    const bump = (actorId: number, bucket: ProductivityBucket, by: number) => {
      const c = counts.get(actorId) ?? emptyCounts();
      c[bucket] += by;
      counts.set(actorId, c);
      totals.set(actorId, (totals.get(actorId) ?? 0) + by);
    };

    for (const row of perAction) {
      if (row.action === "task.status_changed") continue; // classified below from meta
      bump(Number(row.actor_id), productivityBucket(row.action as ActivityAction, null), Number(row.n));
    }
    for (const row of statusChanges) {
      let meta: Record<string, unknown> | null = null;
      if (row.meta !== null && row.meta !== undefined) {
        try {
          meta = typeof row.meta === "string" ? (JSON.parse(row.meta) as Record<string, unknown>) : (row.meta as Record<string, unknown>);
        } catch {
          meta = null;
        }
      }
      bump(Number(row.actor_id), productivityBucket("task.status_changed", meta), 1);
    }
    const activity = new Map(perActor.map((r) => [Number(r.actor_id), r]));

    return users.map((u) => {
      const c = counts.get(u.id) ?? emptyCounts();
      const a = activity.get(u.id);
      return {
        user: toUserSummary(u),
        disabled: u.disabled_at !== null && u.disabled_at !== undefined,
        counts: c,
        totalActions: totals.get(u.id) ?? 0,
        activeDays: Number(a?.days ?? 0),
        projects: Number(a?.projects ?? 0),
        lastActiveAt: fromSqlDateTime(a?.last_at ?? null),
      };
    });
  }
}
