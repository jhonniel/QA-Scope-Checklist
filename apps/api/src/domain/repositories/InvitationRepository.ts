import { randomUUID } from "node:crypto";
import type { InvitationStatus } from "@scope/contracts";
import type { Queryable } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type InvitationRow } from "../models.ts";

const SELECT = `
  SELECT i.id, i.uuid, i.project_id, p.uuid AS project_uuid, p.name AS project_name, i.email, i.role, i.status, i.created_at, i.responded_at,
         ${userSummaryColumns("u", "i")}
  FROM project_invitations i
  INNER JOIN projects p ON p.id = i.project_id
  INNER JOIN users u ON u.id = i.invited_by`;

/**
 * Invitations are append-only history: they move through
 * pending → accepted | declined | revoked and are never deleted.
 */
export class InvitationRepository {
  constructor(private readonly db: Queryable) {}

  /** Every invitation of a project, pending first then newest. */
  listByProject(projectId: number): Promise<InvitationRow[]> {
    return this.db.query<InvitationRow>(
      `${SELECT} WHERE i.project_id = ? ORDER BY CASE i.status WHEN 'pending' THEN 0 ELSE 1 END, i.created_at DESC`,
      [projectId],
    );
  }

  /** Pending invitations addressed to an e-mail, for projects that still exist. */
  listPendingForEmail(email: string): Promise<InvitationRow[]> {
    return this.db.query<InvitationRow>(
      `${SELECT} WHERE i.email = ? AND i.status = 'pending' AND p.deleted_at IS NULL ORDER BY i.created_at DESC`,
      [email.trim().toLowerCase()],
    );
  }

  findByUuid(uuid: string): Promise<InvitationRow | null> {
    return this.db.queryOne<InvitationRow>(`${SELECT} WHERE i.uuid = ?`, [uuid]);
  }

  findById(id: number): Promise<InvitationRow | null> {
    return this.db.queryOne<InvitationRow>(`${SELECT} WHERE i.id = ?`, [id]);
  }

  findPendingByTokenHash(tokenHash: string): Promise<InvitationRow | null> {
    return this.db.queryOne<InvitationRow>(`${SELECT} WHERE i.token_hash = ? AND i.status = 'pending' AND p.deleted_at IS NULL`, [tokenHash]);
  }

  findPending(projectId: number, email: string): Promise<InvitationRow | null> {
    return this.db.queryOne<InvitationRow>(`${SELECT} WHERE i.project_id = ? AND i.email = ? AND i.status = 'pending'`, [projectId, email.trim().toLowerCase()]);
  }

  async create(input: { projectId: number; email: string; role: "editor" | "viewer"; invitedBy: number; tokenHash: string; uuid?: string; createdAt?: string }): Promise<InvitationRow> {
    const result = await this.db.execute(
      "INSERT INTO project_invitations (uuid, project_id, email, role, status, invited_by, token_hash, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
      [input.uuid ?? randomUUID(), input.projectId, input.email.trim().toLowerCase(), input.role, input.invitedBy, input.tokenHash, input.createdAt ?? nowSql()],
    );
    return (await this.findById(result.insertId))!;
  }

  /** Close an invitation. The token is cleared so the e-mailed link stops working. */
  async setStatus(id: number, status: Exclude<InvitationStatus, "pending">): Promise<InvitationRow> {
    await this.db.execute("UPDATE project_invitations SET status = ?, responded_at = ?, token_hash = NULL WHERE id = ?", [status, nowSql(), id]);
    return (await this.findById(id))!;
  }
}
