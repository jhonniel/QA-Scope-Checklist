import { randomUUID } from "node:crypto";
import type { AdminAuditAction } from "@scope/contracts";
import type { Queryable } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type AdminAuditRow } from "../models.ts";

const SELECT = `
  SELECT a.uuid, a.action, a.target_type, a.target_uuid, a.subject, a.meta, a.created_at, ${userSummaryColumns("u", "u")}
  FROM admin_audit_logs a
  INNER JOIN users u ON u.id = a.actor_id`;

/** Append-only trail of administrative actions (never updated or deleted). */
export class AdminAuditRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: { actorId: number; action: AdminAuditAction; targetType: "user" | "project"; targetUuid: string; subject: string; meta?: Record<string, unknown> | null; createdAt?: string }): Promise<void> {
    await this.db.execute("INSERT INTO admin_audit_logs (uuid, actor_id, action, target_type, target_uuid, subject, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      randomUUID(),
      input.actorId,
      input.action,
      input.targetType,
      input.targetUuid,
      input.subject.slice(0, 255),
      input.meta ? JSON.stringify(input.meta) : null,
      input.createdAt ?? nowSql(),
    ]);
  }

  /** Newest first. */
  async page(options: { page: number; perPage: number }): Promise<{ rows: AdminAuditRow[]; total: number }> {
    const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage)));
    const offset = Math.max(0, Math.floor(options.page) - 1) * perPage;
    const count = await this.db.queryOne<{ total: number | string }>("SELECT COUNT(*) AS total FROM admin_audit_logs");
    const rows = await this.db.query<AdminAuditRow>(`${SELECT} ORDER BY a.created_at DESC, a.id DESC LIMIT ${perPage} OFFSET ${offset}`);
    return { rows, total: Number(count?.total ?? 0) };
  }
}
