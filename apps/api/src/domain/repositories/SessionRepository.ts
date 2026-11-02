import type { Queryable } from "../../db/database.ts";
import { nowSql, toSqlDateTime } from "../../db/database.ts";
import type { UserRow } from "../models.ts";

export interface SessionRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  expires_at: string;
  last_seen_at: string;
}

export class SessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(input: { tokenHash: string; userId: number; ip: string | null; userAgent: string | null; expiresAt: Date }): Promise<number> {
    const now = nowSql();
    const result = await this.db.execute(
      "INSERT INTO sessions (token_hash, user_id, ip_address, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [input.tokenHash, input.userId, input.ip, input.userAgent?.slice(0, 255) ?? null, now, now, toSqlDateTime(input.expiresAt)],
    );
    return result.insertId;
  }

  /** Active session + its user, or null if missing/expired/user deleted. */
  findActive(tokenHash: string): Promise<(SessionRow & { user: UserRow }) | null> {
    return this.db
      .queryOne<SessionRow & UserRow & { session_id: number }>(
        `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_seen_at,
                u.id, u.uuid, u.name, u.email, u.password_hash, u.role, u.avatar_url, u.created_at, u.updated_at, u.deleted_at, u.disabled_at, u.clerk_user_id
         FROM sessions s
         INNER JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
        [tokenHash, nowSql()],
      )
      .then((row) => {
        if (!row) return null;
        const { session_id, user_id, expires_at, last_seen_at, ...user } = row;
        return { id: session_id, user_id, expires_at, last_seen_at, user: user as UserRow };
      });
  }

  /** Sliding expiry: bump last_seen/expires. */
  async touch(id: number, expiresAt: Date): Promise<void> {
    await this.db.execute("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [nowSql(), toSqlDateTime(expiresAt), id]);
  }

  async deleteById(id: number): Promise<void> {
    await this.db.execute("DELETE FROM sessions WHERE id = ?", [id]);
  }

  async deleteAllForUser(userId: number, exceptId?: number): Promise<void> {
    if (exceptId) await this.db.execute("DELETE FROM sessions WHERE user_id = ? AND id <> ?", [userId, exceptId]);
    else await this.db.execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
  }

  async purgeExpired(): Promise<number> {
    return (await this.db.execute("DELETE FROM sessions WHERE expires_at <= ?", [nowSql()])).affectedRows;
  }
}
