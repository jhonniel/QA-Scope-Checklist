import { randomUUID } from "node:crypto";
import { RESOLVED_TASK_STATUSES, type SectionKind } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import type { SectionRow } from "../models.ts";

const SELECT = `
  SELECT s.id, s.uuid, s.project_id, p.uuid AS project_uuid, s.title, s.description, s.kind, s.phase_id, ph.uuid AS phase_uuid, s.position, s.completed_at, s.revision_date, s.created_at, s.updated_at
  FROM checklist_sections s
  INNER JOIN projects p ON p.id = s.project_id
  LEFT JOIN project_phases ph ON ph.id = s.phase_id AND ph.deleted_at IS NULL`;

const RESOLVED_IN = `(${RESOLVED_TASK_STATUSES.map((s) => `'${s}'`).join(", ")})`;

/** A section is complete when it has at least one task and none is left unresolved. `section` is the outer table reference. */
const hasTasks = (section: string) => `EXISTS (SELECT 1 FROM tasks t WHERE t.section_id = ${section}.id AND t.deleted_at IS NULL)`;
const hasOpenTasks = (section: string) => `EXISTS (SELECT 1 FROM tasks t WHERE t.section_id = ${section}.id AND t.deleted_at IS NULL AND t.status NOT IN ${RESOLVED_IN})`;

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

  async create(input: { projectId: number; title: string; description: string | null; kind?: SectionKind; phaseId?: number | null; revisionDate?: string | null; position: number; uuid?: string; createdAt?: string }): Promise<SectionRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      "INSERT INTO checklist_sections (uuid, project_id, title, description, kind, phase_id, position, revision_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.projectId, input.title.trim(), input.description?.trim() || null, input.kind ?? "scope", input.phaseId ?? null, input.position, input.revisionDate ?? null, now, now],
    );
    return (await this.findById(result.insertId))!;
  }

  async update(id: number, patch: { title?: string; description?: string | null; kind?: SectionKind; phaseId?: number | null; revisionDate?: string | null }): Promise<SectionRow> {
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
    if (patch.kind !== undefined) {
      sets.push("kind = ?");
      params.push(patch.kind);
    }
    if (patch.phaseId !== undefined) {
      sets.push("phase_id = ?");
      params.push(patch.phaseId);
    }
    if (patch.revisionDate !== undefined) {
      sets.push("revision_date = ?");
      params.push(patch.revisionDate);
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
    await this.db.execute("UPDATE section_references SET deleted_at = ?, updated_at = ? WHERE section_id = ? AND deleted_at IS NULL", [now, now, id]);
    await this.db.execute("UPDATE checklist_sections SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    return tasks.affectedRows;
  }

  /**
   * Bring `completed_at` in line with the tasks of every section in the project:
   * stamp sections that just reached 100% with `at`, clear the stamp of sections
   * that are no longer complete (a task reopened, added or moved in), leave the
   * rest untouched so an existing date is never rewritten. Returns the sections
   * that became complete in this call, for the activity log.
   */
  async refreshCompletion(projectId: number, at: string = nowSql()): Promise<SectionRow[]> {
    const newlyComplete = await this.db.query<{ id: number }>(
      `SELECT s.id FROM checklist_sections s
       WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.completed_at IS NULL AND ${hasTasks("s")} AND NOT ${hasOpenTasks("s")}`,
      [projectId],
    );
    const ids = newlyComplete.map((r) => Number(r.id));
    if (ids.length > 0) {
      await this.db.execute(`UPDATE checklist_sections SET completed_at = ? WHERE id IN (${ids.map(() => "?").join(", ")})`, [at, ...ids]);
    }
    // Correlated on the table itself (no self-referencing subquery) so MySQL accepts it too.
    await this.db.execute(
      `UPDATE checklist_sections SET completed_at = NULL
       WHERE project_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL
         AND (NOT ${hasTasks("checklist_sections")} OR ${hasOpenTasks("checklist_sections")})`,
      [projectId],
    );
    if (ids.length === 0) return [];
    return this.db.query<SectionRow>(`${SELECT} WHERE s.id IN (${ids.map(() => "?").join(", ")}) ORDER BY s.position ASC, s.id ASC`, ids);
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
