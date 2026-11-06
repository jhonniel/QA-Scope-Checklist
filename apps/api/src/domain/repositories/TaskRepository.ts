import { randomUUID } from "node:crypto";
import type { TaskPriority, TaskStatus } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type TaskRow } from "../models.ts";

const SELECT = `
  SELECT t.id, t.uuid, t.project_id, p.uuid AS project_uuid, t.section_id, s.uuid AS section_uuid,
         t.title, t.description, t.status, t.developer_checked_at, t.client_checked_at, t.client_checked_guest_name,
         t.due_date, t.priority, t.position, t.created_at, t.updated_at,
         (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL) AS comment_count,
         ${userSummaryColumns("a", "a")},
         ${userSummaryColumns("d", "d")},
         ${userSummaryColumns("c", "c")}
  FROM tasks t
  INNER JOIN projects p ON p.id = t.project_id
  INNER JOIN checklist_sections s ON s.id = t.section_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN users d ON d.id = t.developer_checked_by
  LEFT JOIN users c ON c.id = t.client_checked_by`;

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  dueDate?: string | null;
  priority?: TaskPriority;
  assigneeId?: number | null;
  sectionId?: number;
  position?: number;
  developerCheck?: { userId: number; at: string } | null;
  clientCheck?: { userId: number | null; guestName?: string | null; at: string } | null;
}

export class TaskRepository {
  constructor(private readonly db: Queryable) {}

  listByProject(projectId: number): Promise<TaskRow[]> {
    return this.db.query<TaskRow>(`${SELECT} WHERE t.project_id = ? AND t.deleted_at IS NULL ORDER BY t.section_id ASC, t.position ASC, t.id ASC`, [projectId]);
  }

  listBySection(sectionId: number): Promise<TaskRow[]> {
    return this.db.query<TaskRow>(`${SELECT} WHERE t.section_id = ? AND t.deleted_at IS NULL ORDER BY t.position ASC, t.id ASC`, [sectionId]);
  }

  findByUuid(uuid: string): Promise<TaskRow | null> {
    return this.db.queryOne<TaskRow>(`${SELECT} WHERE t.uuid = ? AND t.deleted_at IS NULL`, [uuid]);
  }

  findById(id: number): Promise<TaskRow | null> {
    return this.db.queryOne<TaskRow>(`${SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`, [id]);
  }

  /** Internal ids for the checked-by columns, needed when toggling. */
  checkState(id: number): Promise<{ developer_checked_by: number | null; client_checked_by: number | null; client_checked_at: string | null } | null> {
    return this.db.queryOne("SELECT developer_checked_by, client_checked_by, client_checked_at FROM tasks WHERE id = ?", [id]);
  }

  async nextPosition(sectionId: number): Promise<number> {
    const row = await this.db.queryOne<{ n: number | string | null }>("SELECT MAX(position) AS n FROM tasks WHERE section_id = ? AND deleted_at IS NULL", [sectionId]);
    return row?.n === null || row?.n === undefined ? 0 : Number(row.n) + 1;
  }

  async create(input: {
    projectId: number;
    sectionId: number;
    title: string;
    description: string | null;
    status?: TaskStatus;
    dueDate: string | null;
    priority: TaskPriority;
    assigneeId: number | null;
    position: number;
    uuid?: string;
    createdAt?: string;
    developerCheck?: { userId: number; at: string } | null;
    clientCheck?: { userId: number; at: string } | null;
  }): Promise<TaskRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      `INSERT INTO tasks (uuid, project_id, section_id, title, description, status, developer_checked_by, developer_checked_at, client_checked_by, client_checked_at,
                          due_date, priority, assignee_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.uuid ?? randomUUID(),
        input.projectId,
        input.sectionId,
        input.title.trim(),
        input.description?.trim() || null,
        input.status ?? "not_started",
        input.developerCheck?.userId ?? null,
        input.developerCheck?.at ?? null,
        input.clientCheck?.userId ?? null,
        input.clientCheck?.at ?? null,
        input.dueDate,
        input.priority,
        input.assigneeId,
        input.position,
        now,
        now,
      ],
    );
    return (await this.findById(result.insertId))!;
  }

  async update(id: number, patch: TaskPatch): Promise<TaskRow> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    const set = (column: string, value: SqlParam) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.title !== undefined) set("title", patch.title.trim());
    if (patch.description !== undefined) set("description", patch.description?.trim() || null);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.dueDate !== undefined) set("due_date", patch.dueDate);
    if (patch.priority !== undefined) set("priority", patch.priority);
    if (patch.assigneeId !== undefined) set("assignee_id", patch.assigneeId);
    if (patch.sectionId !== undefined) set("section_id", patch.sectionId);
    if (patch.position !== undefined) set("position", patch.position);
    if (patch.developerCheck !== undefined) {
      set("developer_checked_by", patch.developerCheck?.userId ?? null);
      set("developer_checked_at", patch.developerCheck?.at ?? null);
    }
    if (patch.clientCheck !== undefined) {
      set("client_checked_by", patch.clientCheck?.userId ?? null);
      set("client_checked_at", patch.clientCheck?.at ?? null);
      set("client_checked_guest_name", patch.clientCheck ? (patch.clientCheck.guestName ?? null) : null);
    }
    set("updated_at", nowSql());
    params.push(id);
    await this.db.execute(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, params);
    return (await this.findById(id))!;
  }

  async softDelete(id: number): Promise<void> {
    await this.db.execute("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?", [nowSql(), nowSql(), id]);
  }

  /** Apply a new order inside a section; tasks may be moved in from another section. */
  async reorder(sectionId: number, orderedIds: number[]): Promise<void> {
    const now = nowSql();
    for (let i = 0; i < orderedIds.length; i += 1) {
      await this.db.execute("UPDATE tasks SET section_id = ?, position = ?, updated_at = ? WHERE id = ?", [sectionId, i, now, orderedIds[i]]);
    }
  }

  /** Resolve public uuids to internal ids within one project, preserving order. */
  async idsForUuids(projectId: number, uuids: string[]): Promise<number[]> {
    if (uuids.length === 0) return [];
    const rows = await this.db.query<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM tasks WHERE project_id = ? AND deleted_at IS NULL AND uuid IN (${uuids.map(() => "?").join(", ")})`,
      [projectId, ...uuids],
    );
    const byUuid = new Map(rows.map((r) => [r.uuid, Number(r.id)]));
    return uuids.map((u) => byUuid.get(u)).filter((id): id is number => id !== undefined);
  }
}
