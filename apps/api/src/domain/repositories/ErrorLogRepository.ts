import { randomUUID } from "node:crypto";
import type { ErrorLogSource } from "@scope/contracts";
import type { Queryable, SqlParam } from "../../db/database.ts";
import { nowSql, toSqlDateTime } from "../../db/database.ts";
import { userSummaryColumns, type ErrorLogRow } from "../models.ts";

const SELECT = `
  SELECT e.uuid, e.source, e.status, e.code, e.message, e.stack, e.method, e.path, e.user_agent, e.context, e.created_at, ${userSummaryColumns("u", "u")}
  FROM error_logs e
    LEFT JOIN users u ON u.id = e.actor_id`;

/** Column caps so one runaway error cannot bloat the table. */
const LIMITS = { code: 80, message: 2000, stack: 8000, method: 10, path: 2048, userAgent: 512, context: 4000 } as const;

export interface ErrorLogInput {
  source: ErrorLogSource;
  status?: number | null;
  code?: string | null;
  message: string;
  stack?: string | null;
  method?: string | null;
  path?: string | null;
  actorId?: number | null;
  userAgent?: string | null;
  context?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface ErrorLogPageOptions {
  page: number;
  perPage: number;
  source?: ErrorLogSource;
  /** Matches message, code or path. */
  search?: string;
}

/** Append-only record of failures (never updated or deleted). */
export class ErrorLogRepository {
  constructor(private readonly db: Queryable) {}

  async record(input: ErrorLogInput): Promise<string> {
    const uuid = randomUUID();
    const cut = (value: string | null | undefined, max: number) => (value === null || value === undefined ? null : String(value).slice(0, max));
    let context: string | null = null;
    if (input.context) {
      const json = JSON.stringify(input.context);
      context = json.length > LIMITS.context ? JSON.stringify({ truncated: true }) : json;
    }
    await this.db.execute(
      "INSERT INTO error_logs (uuid, source, status, code, message, stack, method, path, actor_id, user_agent, context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        uuid,
        input.source,
        input.status ?? null,
        cut(input.code, LIMITS.code),
        cut(input.message, LIMITS.message) || "(no message)",
        cut(input.stack, LIMITS.stack),
        cut(input.method, LIMITS.method),
        cut(input.path, LIMITS.path),
        input.actorId ?? null,
        cut(input.userAgent, LIMITS.userAgent),
        context,
        input.createdAt ?? nowSql(),
      ],
    );
    return uuid;
  }

  async findByUuid(uuid: string): Promise<ErrorLogRow | null> {
    return this.db.queryOne<ErrorLogRow>(`${SELECT} WHERE e.uuid = ?`, [uuid]);
  }

  /** Newest first. */
  async page(options: ErrorLogPageOptions): Promise<{ rows: ErrorLogRow[]; total: number }> {
    const perPage = Math.max(1, Math.min(100, Math.floor(options.perPage)));
    const offset = Math.max(0, Math.floor(options.page) - 1) * perPage;
    const where: string[] = [];
    const params: SqlParam[] = [];
    if (options.source) {
      where.push("e.source = ?");
      params.push(options.source);
    }
    if (options.search) {
      // LOWER() on both sides: LIKE is case-sensitive on PostgreSQL (and on binary collations).
      const like = `%${options.search.toLowerCase()}%`;
      where.push("(LOWER(e.message) LIKE ? OR LOWER(e.code) LIKE ? OR LOWER(e.path) LIKE ?)");
      params.push(like, like, like);
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    const count = await this.db.queryOne<{ total: number | string }>(`SELECT COUNT(*) AS total FROM error_logs e${clause}`, params);
    const rows = await this.db.query<ErrorLogRow>(`${SELECT}${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT ${perPage} OFFSET ${offset}`, params);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** Totals for the admin overview. */
  async counts(now: Date = new Date()): Promise<{ total: number; last24Hours: number; last7Days: number }> {
    const since24h = toSqlDateTime(new Date(now.getTime() - 86_400_000));
    const since7d = toSqlDateTime(new Date(now.getTime() - 7 * 86_400_000));
    const row = await this.db.queryOne<{ total: number | string; last_24h: number | string; last_7d: number | string }>(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_24h, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_7d FROM error_logs",
      [since24h, since7d],
    );
    return { total: Number(row?.total ?? 0), last24Hours: Number(row?.last_24h ?? 0), last7Days: Number(row?.last_7d ?? 0) };
  }
}
