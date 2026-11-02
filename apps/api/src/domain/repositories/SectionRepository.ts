import { randomUUID } from "node:crypto";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import type { SectionRow } from "../models.ts";

const SELECT = `
  SELECT s.id, s.uuid, s.project_id, p.uuid AS project_uuid, s.title, s.description, s.position, s.created_at, s.updated_at
  FROM checklist_sections s
  INNER JOIN projects p ON p.id = s.project_id`;

export class SectionRepository {
  constructor(private readonly db: Queryable) {}

  listByProject(projectId: number): Promise<SectionRow[]> {
    return this.db.query<SectionRow>(`${SELECT} WHERE s.project_id = ? AND s.deleted_at IS NULL ORDER BY s.position ASC, s.id ASC`, [projectId]);
  }

  findByUuid(uuid: string): Promise<SectionRow | null> {
    return this.db.queryOne<SectionRow>(`${SELECT} WHERE s.uuid = ? AND s.deleted_at IS NULL`, [uuid]);
  }

  findById(id: number): Promise<SectionRow | null> {
    return this.db.queryOne<SectionRow>(`${SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`, [id]);
  }

  async nextPosition(projectId: number): Promise<number> {
    const row = await this.db.queryOne<{ n: number | string | null }>("SELECT MAX(position) AS n FROM checklist_sections WHERE project_id = ? AND deleted_at IS NULL", [projectId]);
    return row?.n === null || row?.n === undefined ? 0 : Number(row.n) + 1;
  }

  async create(input: { projectId: number; title: string; description: string | null; position: number; uuid?: string; createdAt?: string }): Promise<SectionRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      "INSERT INTO checklist_sections (uuid, project_id, title, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.projectId, input.title.trim(), input.description?.trim() || null, input.position, now, now],
    );
    return (await this.findById(result.insertId))!;
  }

  async update(id: number, patch: { title?: string; description?: string | null }): Promise<SectionRow> {
    const sets: string[] = [];
    const params: SqlParam[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(patch.title.trim());
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      params.push(patch.description?.trim() || null);
    }
    sets.push("updated_at = ?");
    params.push(nowSql(), id);
    await this.db.execute(`UPDATE checklist_sections SET ${sets.join(", ")} WHERE id = ?`, params);
    return (await this.findById(id))!;
  }

  /** Soft-delete the section and every task inside it (history is preserved). Returns the number of tasks affected. */
  async softDelete(id: number): Promise<number> {
    const now = nowSql();
    const tasks = await this.db.execute("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE section_id = ? AND deleted_at IS NULL", [now, now, id]);
    await this.db.execute("UPDATE checklist_sections SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    return tasks.affectedRows;
  }

  async reorder(orderedIds: number[]): Promise<void> {
    const now = nowSql();
    for (let i = 0; i < orderedIds.length; i += 1) {
      await this.db.execute("UPDATE checklist_sections SET position = ?, updated_at = ? WHERE id = ?", [i, now, orderedIds[i]]);
    }
  }

  /** Resolve public uuids to internal ids within one project, preserving order. */
  async idsForUuids(projectId: number, uuids: string[]): Promise<number[]> {
    if (uuids.length === 0) return [];
    const rows = await this.db.query<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM checklist_sections WHERE project_id = ? AND deleted_at IS NULL AND uuid IN (${uuids.map(() => "?").join(", ")})`,
      [projectId, ...uuids],
    );
    const byUuid = new Map(rows.map((r) => [r.uuid, Number(r.id)]));
    return uuids.map((u) => byUuid.get(u)).filter((id): id is number => id !== undefined);
  }
}
