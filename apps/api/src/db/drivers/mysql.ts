import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { Database, ExecResult, Queryable, Row, SqlParam } from "../database.ts";
import { splitStatements } from "../database.ts";

export { splitStatements };

export interface MysqlOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Driver over a mysql2 connection pool. */
export function createMysqlDatabase(options: MysqlOptions): Database {
  const pool: Pool = mysql.createPool({
    ...options,
    waitForConnections: true,
    connectionLimit: 10,
    // Return DATE/DATETIME as strings so both drivers hand repositories the same shape.
    dateStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
  });

  const wrap = (conn: Pool | PoolConnection): Queryable => ({
    async query<T extends Row>(sql: string, params: SqlParam[] = []) {
      const [rows] = await conn.execute<RowDataPacket[]>(sql, params);
      return rows as unknown as T[];
    },
    async queryOne<T extends Row>(sql: string, params: SqlParam[] = []) {
      const [rows] = await conn.execute<RowDataPacket[]>(sql, params);
      return (rows[0] as unknown as T | undefined) ?? null;
    },
    async execute(sql: string, params: SqlParam[] = []): Promise<ExecResult> {
      const [result] = await conn.execute<ResultSetHeader>(sql, params);
      return { affectedRows: result.affectedRows, insertId: Number(result.insertId) };
    },
  });

  return {
    client: "mysql",
    ...wrap(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const value = await fn(wrap(conn));
        await conn.commit();
        return value;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },
    async raw(sql: string) {
      // DDL may contain several statements; run them one by one.
      const conn = await pool.getConnection();
      try {
        for (const statement of splitStatements(sql)) await conn.query(statement);
      } finally {
        conn.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}