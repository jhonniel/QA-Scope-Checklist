import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Database, ExecResult, Queryable, Row, SqlParam } from "../database.ts";

/**
 * Driver over Node's built-in SQLite (synchronous API wrapped in promises).
 * Used for development and tests; the SQL written by repositories is the
 * same as for MySQL.
 */
export function createSqliteDatabase(file: string, packageRoot: string): Database {
  const path = file === ":memory:" ? file : isAbsolute(file) ? file : join(packageRoot, file);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  const normalise = (params: SqlParam[] = []) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

  const queryable: Queryable = {
    async query<T extends Row>(sql: string, params: SqlParam[] = []) {
      return db.prepare(sql).all(...normalise(params)) as T[];
    },
    async queryOne<T extends Row>(sql: string, params: SqlParam[] = []) {
      return (db.prepare(sql).get(...normalise(params)) as T | undefined) ?? null;
    },
    async execute(sql: string, params: SqlParam[] = []): Promise<ExecResult> {
      const result = db.prepare(sql).run(...normalise(params));
      return { affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) };
    },
  };

  // SQLite has one connection, so a transaction simply brackets the calls.
  // Nested calls reuse the outer transaction via savepoints.
  let depth = 0;

  return {
    client: "sqlite",
    ...queryable,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const savepoint = `sp_${depth}`;
      db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
      depth += 1;
      try {
        const value = await fn(queryable);
        depth -= 1;
        db.exec(depth === 0 ? "COMMIT" : `RELEASE SAVEPOINT ${savepoint}`);
        return value;
      } catch (error) {
        depth -= 1;
        db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    },
    async raw(sql: string) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}
