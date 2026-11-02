import { randomUUID } from "node:crypto";
import type { Queryable } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { userSummaryColumns, type CommentRow } from "../models.ts";

const SELECT = `
  SELECT c.id, c.uuid, t.uuid AS task_uuid, c.body, c.created_at, c.updated_at, ${userSummaryColumns("u", "u")}
  FROM task_comments c
  INNER JOIN tasks t ON t.id = c.task_id
  INNER JOIN users u ON u.id = c.author_id`;

export class CommentRepository {
  constructor(private readonly db: Queryable) {}

  listByTask(taskId: number): Promise<CommentRow[]> {
    return this.db.query<CommentRow>(`${SELECT} WHERE c.task_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at ASC, c.id ASC`, [taskId]);
  }

  async create(input: { taskId: number; authorId: number; body: string; uuid?: string; createdAt?: string }): Promise<CommentRow> {
    const now = input.createdAt ?? nowSql();
    const result = await this.db.execute("INSERT INTO task_comments (uuid, task_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
      input.uuid ?? randomUUID(),
      input.taskId,
      input.authorId,
      input.body.trim(),
      now,
      now,
    ]);
    return (await this.db.queryOne<CommentRow>(`${SELECT} WHERE c.id = ?`, [result.insertId]))!;
  }
}
