import { randomUUID } from "node:crypto";
import type { SectionReferenceKind } from "@scope/contracts";
import type { Queryable } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type SectionReferenceRow } from "../models.ts";

const SELECT = `
  SELECT r.id, r.uuid, r.section_id, s.uuid AS section_uuid, r.kind, r.body, r.title, r.created_at, r.updated_at, ${userSummaryColumns("u", "u")}
  FROM section_references r
  INNER JOIN checklist_sections s ON s.id = r.section_id
  INNER JOIN users u ON u.id = r.author_id`;

export class SectionReferenceRepository {
  constructor(private readonly db: Queryable) {}

  listBySectionIds(sectionIds: number[]): Promise<SectionReferenceRow[]> {
    if (sectionIds.length === 0) return Promise.resolve([]);
    return this.db.query<SectionReferenceRow>(
      `${SELECT} WHERE r.section_id IN (${sectionIds.map(() => "?").join(", ")}) AND r.deleted_at IS NULL ORDER BY r.created_at ASC, r.id ASC`,
      sectionIds,
    );
  }

  findByUuid(uuid: string): Promise<SectionReferenceRow | null> {
    return this.db.queryOne<SectionReferenceRow>(`${SELECT} WHERE r.uuid = ? AND r.deleted_at IS NULL`, [uuid]);
  }

  async create(input: {
    sectionId: number;
    authorId: number;
    kind: SectionReferenceKind;
    body: string;
    title: string | null;
    uuid?: string;
    createdAt?: string;
  }): Promise<SectionReferenceRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute(
      "INSERT INTO section_references (uuid, section_id, author_id, kind, body, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.sectionId, input.authorId, input.kind, input.body.trim(), input.title?.trim() || null, now, now],
    );
    return (await this.db.queryOne<SectionReferenceRow>(`${SELECT} WHERE r.id = ?`, [result.insertId]))!;
  }

  async softDelete(id: number): Promise<void> {
    const now = nowSql();
    await this.db.execute("UPDATE section_references SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [now, now, id]);
  }
}
