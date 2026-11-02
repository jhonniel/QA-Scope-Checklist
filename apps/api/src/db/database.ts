/**
 * Minimal database abstraction.
 *
 * Repositories write parameterised SQL (`?` placeholders) in MySQL-compatible
 * syntax against this interface. Three drivers exist: the built-in
 * `node:sqlite` for zero-install development, `mysql2` for MySQL/MariaDB and
 * `pg` for PostgreSQL (which rewrites `?` to `$n` and adds `RETURNING id`).
 * No ORM is used so the schema and queries translate directly to Laravel
 * migrations and Eloquent later.
 *
 * Portability rules the repositories follow so one query runs on all three:
 * `?` placeholders only; `LOWER(col) LIKE ?` for case-insensitive search;
 * inline `LIMIT n OFFSET m`; JSON read through `parseJsonColumn`-style helpers
 * that accept text or parsed values; booleans through `toBool`.
 */

export type SqlClient = "sqlite" | "mysql" | "postgres";
export type SqlParam = string | number | boolean | null;
export type Row = Record<string, unknown>;

export interface ExecResult {
  affectedRows: number;
  insertId: number;
}

export interface Queryable {
  /** SELECT — returns every row. */
  query<T extends Row = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** SELECT — returns the first row or null. */
  queryOne<T extends Row = Row>(sql: string, params?: SqlParam[]): Promise<T | null>;
  /** INSERT / UPDATE / DELETE. */
  execute(sql: string, params?: SqlParam[]): Promise<ExecResult>;
}

export interface Database extends Queryable {
  readonly client: SqlClient;
  /** Run `fn` inside a transaction. Rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Run raw DDL (migrations). Multiple statements separated by `;` are allowed. */
  raw(sql: string): Promise<void>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Value helpers shared by repositories
// ---------------------------------------------------------------------------

/** Current time as a DATETIME literal (UTC, second precision). */
export function nowSql(date: Date = new Date()): string {
  return toSqlDateTime(date);
}

/** Date → 'YYYY-MM-DD HH:MM:SS' (UTC). */
export function toSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** 'YYYY-MM-DD HH:MM:SS' (UTC) → ISO-8601 with Z. Null-safe. */
export function fromSqlDateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  if (s.includes("T")) return s.endsWith("Z") ? s : `${s}Z`;
  return `${s.replace(" ", "T")}Z`;
}

/** Normalise driver booleans (0/1, '0'/'1', true/false). */
export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/** DATE columns come back as 'YYYY-MM-DD' strings (mysql2 `dateStrings`, pg type parsers) or null. */
export function fromSqlDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Split a DDL script on `;` at end of statement, ignoring semicolons inside
 * quotes. `-- …` line comments are dropped so punctuation in prose never
 * splits or pollutes a statement.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote && sql[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const eol = sql.indexOf("\n", i);
      i = eol === -1 ? sql.length : eol - 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Rewrite `?` placeholders to PostgreSQL's `$1, $2, …`, leaving question
 * marks inside string literals and quoted identifiers alone.
 */
export function toPositionalPlaceholders(sql: string): string {
  let out = "";
  let quote: string | null = null;
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote && sql[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "?") {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}
