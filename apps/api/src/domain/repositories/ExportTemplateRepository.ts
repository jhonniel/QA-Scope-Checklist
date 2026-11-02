import type { Queryable } from "../../db/database.ts";
import type { ExportTemplateRow } from "../models.ts";

const SELECT = "SELECT id, uuid, name, description, is_default, definition, created_at, updated_at FROM export_templates";

/** Document templates are reference data: seeded, read by the export service, never deleted. */
export class ExportTemplateRepository {
  constructor(private readonly db: Queryable) {}

  /** Default first, then alphabetical. */
  listAll(): Promise<ExportTemplateRow[]> {
    return this.db.query<ExportTemplateRow>(`${SELECT} ORDER BY is_default DESC, name ASC`);
  }

  findByUuid(uuid: string): Promise<ExportTemplateRow | null> {
    return this.db.queryOne<ExportTemplateRow>(`${SELECT} WHERE uuid = ?`, [uuid]);
  }

  findDefault(): Promise<ExportTemplateRow | null> {
    return this.db.queryOne<ExportTemplateRow>(`${SELECT} ORDER BY is_default DESC, id ASC LIMIT 1`);
  }
}
