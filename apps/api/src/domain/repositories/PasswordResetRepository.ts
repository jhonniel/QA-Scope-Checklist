import type { Queryable } from "../../db/database.ts";
import { nowSql, toSqlDateTime } from "../../db/database.ts";

export interface PasswordResetRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  expires_at: string;
  used_at: string | null;
}

export class PasswordResetRepository {
  constructor(private readonly db: Queryable) {}

  async create(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    // One live token per user: invalidate the previous ones first.
    await this.db.execute("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", [nowSql(), userId]);
    await this.db.execute("INSERT INTO password_resets (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)", [userId, tokenHash, nowSql(), toSqlDateTime(expiresAt)]);
  }

  findValid(tokenHash: string): Promise<PasswordResetRow | null> {
    return this.db.queryOne<PasswordResetRow>("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?", [tokenHash, nowSql()]);
  }

  async markUsed(id: number): Promise<void> {
    await this.db.execute("UPDATE password_resets SET used_at = ? WHERE id = ?", [nowSql(), id]);
  }
}
