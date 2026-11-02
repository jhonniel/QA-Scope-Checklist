import { config } from "../config.ts";
import type { Database } from "./database.ts";
import { createMysqlDatabase } from "./drivers/mysql.ts";
import { createPostgresDatabase } from "./drivers/postgres.ts";
import { createSqliteDatabase } from "./drivers/sqlite.ts";

export type { Database, Queryable, Row, SqlClient, SqlParam } from "./database.ts";
export { fromSqlDate, fromSqlDateTime, nowSql, toBool, toSqlDateTime } from "./database.ts";

/** Build the configured database connection. One instance per process. */
export function createDatabase(): Database {
  if (config.db.client === "postgres") {
    return createPostgresDatabase(
      config.db.url
        ? { connectionString: config.db.url, ssl: config.db.ssl }
        : { host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database, ssl: config.db.ssl },
    );
  }
  if (config.db.client === "mysql") {
    return createMysqlDatabase({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
    });
  }
  return createSqliteDatabase(config.db.file, config.packageRoot);
}
