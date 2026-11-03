import { randomUUID } from "node:crypto";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import type { PhaseRow } from "../models.ts";

const SELECT = `
  SELECT ph.id, ph.uuid, ph.project_id, p.uuid AS project_uuid, ph.title, ph.color, ph.position, ph.created_at, ph.updated_at
  FROM project_phases ph
  INNER JOIN projects p ON p.id = ph.project_id`;

export class PhaseRepository {
  constructor(private readonly db: Queryable) {}

  listByProject(projectId: number): Promise<PhaseRow[]> {
    return this.db.query<PhaseRow>(`${SELECT} WHERE ph.project_id = ? AND ph.deleted_at IS NULL ORDER BY ph.position ASC, ph.id ASC`, [projectId]);
  }

  findByUuid(uuid: string): Promise<PhaseRow | null> {
    return this.db.queryOne<PhaseRow>(`${SELECT} WHERE ph.uuid = ? AND ph.deleted_at IS NULL`, [uuid]);
  }

  findById(id: number): Promise<PhaseRow | null> {
    return this.db.queryOne<PhaseRow>(`${SELECT} WHERE ph.id = ? AND ph.deleted_at IS NULL`, [id]);
  }

  async nextPosition(projectId: number): Promise<number> {
    const row = await this.db.queryOne<{ n: number | string | null }>("SELECT MAX(position) AS n FROM project_phases WHERE project_id = ? AND deleted_at IS NULL", [projectId]);
    return row?.n === null || row?.n === undefined ? 0 : Number(row.n) + 1;
  }

  async create(input: { projectId: number; title: string; color: string; position: number; uuid?: string; createdAt?: string }): Promise<PhaseRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      "INSERT INTO project_phases (uuid, project_id, title, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.projectId, input.title.trim(), input.color, input.position, now, now],
    );
    return (await this.findById(result.insertId))!;
  }

  async update(id: number, input: { title?: string; color?: string }): Promise<PhaseRow> {
    const now = nowSql();
    const sets: string[] = [];
    const args: SqlParam[] = [];
    if (input.title !== undefined) {
      sets.push("title = ?");
      args.push(input.title.trim());
    }
    if (input.color !== undefined) {
      sets.push("color = ?");
      args.push(input.color);
    }
    sets.push("updated_at = ?");
    args.push(now, id);
    await this.db.execute(`UPDATE project_phases SET ${sets.join(", ")} WHERE id = ?`, args);
    return (await this.findById(id))!;
  }

  /** Soft-delete the phase and ungroup its sections. */
  async softDelete(id: number): Promise<void> {
    const now = nowSql();
    await this.db.execute("UPDATE checklist_sections SET phase_id = NULL, updated_at = ? WHERE phase_id = ? AND deleted_at IS NULL", [now, id]);
    await this.db.execute("UPDATE project_phases SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
  }

  async reorder(orderedIds: number[]): Promise<void> {
    const now = nowSql();
    for (let i = 0; i < orderedIds.length; i += 1) {
      await this.db.execute("UPDATE project_phases SET position = ?, updated_at = ? WHERE id = ?", [i, now, orderedIds[i]]);
    }
  }

  async idsForUuids(projectId: number, uuids: string[]): Promise<number[]> {
    if (uuids.length === 0) return [];
    const rows = await this.db.query<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM project_phases WHERE project_id = ? AND deleted_at IS NULL AND uuid IN (${uuids.map(() => "?").join(", ")})`,
      [projectId, ...uuids],
    );
    const byUuid = new Map(rows.map((r) => [r.uuid, Number(r.id)]));
    return uuids.map((u) => byUuid.get(u)).filter((id): id is number => id !== undefined);
  }
}
