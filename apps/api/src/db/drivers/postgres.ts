import pg, { type Pool, type PoolClient } from "pg";
import type { Database, ExecResult, Queryable, Row, SqlParam } from "../database.ts";
import { splitStatements, toPositionalPlaceholders } from "../database.ts";

export interface PostgresOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** Alternative to the discrete fields, e.g. `postgres://user:pass@host:5432/db`. */
  connectionString?: string;
  /** `false` (default), `true` (verify the server certificate) or `"no-verify"` (encrypt only — self-signed managed hosts). */
  ssl?: boolean | "no-verify";
  /** Run everything inside this schema (tests isolate themselves this way). */
  schema?: string;
  max?: number;
}

/**
 * Driver over node-postgres. The repositories' MySQL-flavoured SQL is adapted
 * here, not in the repositories:
 *
 * - `?` placeholders become `$1, $2, …`.
 * - `INSERT` statements get `RETURNING id` so `insertId` works like in MySQL/SQLite.
 * - Type parsers return the same shapes the other drivers produce: DATE and
 *   TIMESTAMP as 'YYYY-MM-DD[ HH:MM:SS]' strings, BIGINT/NUMERIC counts as
 *   numbers, JSON/JSONB as text (the models accept text or parsed values).
 */
export function createPostgresDatabase(options: PostgresOptions): Database {
  const pool: Pool = new pg.Pool({
    host: options.host,
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    connectionString: options.connectionString,
    ssl: options.ssl === "no-verify" ? { rejectUnauthorized: false } : options.ssl ? true : undefined,
    max: options.max ?? 10,
    types: resultTypes,
  });
  if (options.schema) {
    const schema = quoteIdent(options.schema);
    pool.on("connect", (client) => {
      client.query(`SET search_path TO ${schema}`).catch(() => {
        /* surfaces on the first real query instead */
      });
    });
  }

  const wrap = (conn: Pool | PoolClient): Queryable => ({
    async query<T extends Row>(sql: string, params: SqlParam[] = []) {
      const result = await conn.query(toPositionalPlaceholders(sql), params);
      return result.rows as T[];
    },
    async queryOne<T extends Row>(sql: string, params: SqlParam[] = []) {
      const result = await conn.query(toPositionalPlaceholders(sql), params);
      return (result.rows[0] as T | undefined) ?? null;
    },
    async execute(sql: string, params: SqlParam[] = []): Promise<ExecResult> {
      const result = await conn.query(withReturningId(toPositionalPlaceholders(sql)), params);
      const first = result.rows[0] as { id?: unknown } | undefined;
      return { affectedRows: result.rowCount ?? 0, insertId: first && first.id !== undefined ? Number(first.id) : 0 };
    },
  });

  return {
    client: "postgres",
    ...wrap(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async raw(sql: string) {
      const client = await pool.connect();
      try {
        for (const statement of splitStatements(sql)) await client.query(statement);
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/**
 * Per-pool result parsers (scoped here so another `pg` user in the process is
 * unaffected). Values the other drivers hand back as strings stay strings.
 */
const asString = (value: string) => value;
const asNumber = (value: string) => Number(value);
const PARSERS = new Map<number, (value: string) => unknown>([
  // Repositories compare and format date/time values as 'YYYY-MM-DD[ HH:MM:SS]' strings (UTC) everywhere.
  [pg.types.builtins.DATE, asString],
  [pg.types.builtins.TIMESTAMP, asString],
  [pg.types.builtins.TIMESTAMPTZ, asString],
  // COUNT(*) / SUM(...) arrive as int8 / numeric strings by default.
  [pg.types.builtins.INT8, asNumber],
  [pg.types.builtins.NUMERIC, asNumber],
  // The models parse JSON text themselves, like with SQLite.
  [pg.types.builtins.JSON, asString],
  [pg.types.builtins.JSONB, asString],
]);
const resultTypes: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    const custom = format === "binary" ? undefined : PARSERS.get(oid);
    return custom ?? (format === "binary" ? pg.types.getTypeParser(oid, format) : pg.types.getTypeParser(oid));
  }) as pg.CustomTypesConfig["getTypeParser"],
};

/** `INSERT …` → `INSERT … RETURNING id` unless the statement already returns something. */
export function withReturningId(sql: string): string {
  const trimmed = sql.trim().replace(/;$/, "");
  if (!/^insert\s/i.test(trimmed) || /\sreturning\s/i.test(trimmed)) return trimmed;
  return `${trimmed} RETURNING id`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
