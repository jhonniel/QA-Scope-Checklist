import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./database.ts";
import { nowSql } from "./database.ts";

/**
 * Plain-SQL migrations.
 *
 * Files live in `db/migrations/NNNN_name.sql`, written in MySQL-compatible
 * syntax. A handful of `{{TOKEN}}` placeholders cover the few places where
 * SQLite, MySQL and PostgreSQL differ, so one file drives every engine and
 * still reads like a normal MySQL script (and translates 1:1 to a Laravel
 * migration).
 *
 *   {{PK}}        auto-increment primary key column definition
 *   {{FK}}        column type that references a {{PK}}
 *   {{JSON}}      JSON column type (TEXT on SQLite, JSONB on PostgreSQL)
 *   {{BOOL}}      boolean column type
 *   {{ENGINE}}    trailing table options (InnoDB/utf8mb4 on MySQL, empty elsewhere)
 *   {{WIDEN_SECTION_TITLE}}  raise checklist_sections.title to VARCHAR(500)
 *
 * PostgreSQL additionally gets two mechanical rewrites so the files stay
 * MySQL-shaped: the `DATETIME` type becomes `TIMESTAMP`, and `DEFAULT 0/1`
 * after a `{{BOOL}}` column becomes `DEFAULT FALSE/TRUE`.
 *
 * Applied files are recorded in the `migrations` table and never re-run.
 */

const TOKENS: Record<Database["client"], Record<string, string>> = {
  postgres: {
    PK: "BIGSERIAL PRIMARY KEY",
    FK: "BIGINT",
    JSON: "JSONB",
    BOOL: "BOOLEAN",
    ENGINE: "",
    WIDEN_SECTION_TITLE: "ALTER TABLE checklist_sections ALTER COLUMN title TYPE VARCHAR(500)",
  },
  mysql: {
    PK: "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    FK: "BIGINT UNSIGNED",
    JSON: "JSON",
    BOOL: "TINYINT(1)",
    ENGINE: " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    WIDEN_SECTION_TITLE: "ALTER TABLE checklist_sections MODIFY COLUMN title VARCHAR(500) NOT NULL",
  },
  sqlite: {
    PK: "INTEGER PRIMARY KEY AUTOINCREMENT",
    FK: "INTEGER",
    JSON: "TEXT",
    BOOL: "INTEGER",
    ENGINE: "",
    // SQLite stores TEXT and does not enforce VARCHAR length.
    WIDEN_SECTION_TITLE: "SELECT 1",
  },
};

export function renderSql(sql: string, client: Database["client"]): string {
  const dialect = client === "postgres" ? toPostgresDdl(sql) : sql;
  return dialect.replace(/\{\{(\w+)\}\}/g, (_, token: string) => {
    const value = TOKENS[client][token];
    if (value === undefined) throw new Error(`Unknown migration token {{${token}}}`);
    return value;
  });
}

/** MySQL-flavoured DDL → PostgreSQL DDL (applied before the tokens are expanded). */
function toPostgresDdl(sql: string): string {
  return sql
    .replace(/\bDATETIME\b/gi, "TIMESTAMP")
    .replace(/(\{\{BOOL\}\}[^,\n]*?\bDEFAULT\s+)([01])\b/gi, (_, head: string, value: string) => `${head}${value === "1" ? "TRUE" : "FALSE"}`);
}

async function ensureLedger(db: Database) {
  await db.raw(
    renderSql(
      `CREATE TABLE IF NOT EXISTS migrations (
        id {{PK}},
        name VARCHAR(191) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL
      ){{ENGINE}}`,
      db.client,
    ),
  );
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(db: Database, dir: string, log: (msg: string) => void = () => {}): Promise<MigrationResult> {
  await ensureLedger(db);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM migrations")).map((r) => r.name));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = renderSql(readFileSync(join(dir, file), "utf8"), db.client);
    log(`Applying ${file}`);
    await db.raw(sql);
    await db.execute("INSERT INTO migrations (name, applied_at) VALUES (?, ?)", [file, nowSql()]);
    result.applied.push(file);
  }
  return result;
}

/** Drop every known table (development only). */
export async function dropAll(db: Database) {
  const tables = [
    "password_resets",
    "sessions",
    "error_logs",
    "admin_audit_logs",
    "activity_logs",
    "task_comments",
    "tasks",
    "checklist_sections",
    "project_invitations",
    "project_members",
    "projects",
    "export_templates",
    "users",
    "migrations",
  ];
  if (db.client === "postgres") {
    // Tables are listed children-first; CASCADE covers anything added out of order.
    for (const table of tables) await db.raw(`DROP TABLE IF EXISTS ${table} CASCADE`);
    return;
  }
  if (db.client === "mysql") await db.raw("SET FOREIGN_KEY_CHECKS = 0");
  else await db.raw("PRAGMA foreign_keys = OFF");
  for (const table of tables) await db.raw(`DROP TABLE IF EXISTS ${table}`);
  if (db.client === "mysql") await db.raw("SET FOREIGN_KEY_CHECKS = 1");
  else await db.raw("PRAGMA foreign_keys = ON");
}
