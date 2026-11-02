import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../src/app.ts";
import { config as baseConfig, type Config } from "../src/config.ts";
import { randomBytes } from "node:crypto";
import type { Database } from "../src/db/database.ts";
import { createPostgresDatabase } from "../src/db/drivers/postgres.ts";
import { createSqliteDatabase } from "../src/db/drivers/sqlite.ts";
import { migrate } from "../src/db/migrator.ts";
import { seedDevelopment } from "../src/db/seeders/dev.ts";
import type { MailMessage, MailService } from "../src/domain/services/MailService.ts";

/**
 * Feature-test harness: a real HTTP server over the real Express app, backed
 * by a database that is migrated and seeded with the development fixtures.
 * Each `startTestServer()` call is fully isolated.
 *
 * By default that database is in-memory SQLite. Set `TEST_DB_CLIENT=postgres`
 * and `TEST_DATABASE_URL` (or `DATABASE_URL`) to run the same suite against a
 * PostgreSQL server — every test server then gets its own schema, dropped on
 * close. CI does exactly this in the `api-postgres` job.
 */

export const ORIGIN = "http://app.test";

export const TEST_DB_CLIENT: "sqlite" | "postgres" = process.env.TEST_DB_CLIENT === "postgres" ? "postgres" : "sqlite";

/** Open a fresh, isolated, migrated (not seeded) database for the configured test driver. */
export async function openTestDatabase(): Promise<{ db: Database; close(): Promise<void> }> {
  if (TEST_DB_CLIENT === "postgres") {
    const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) throw new Error("TEST_DB_CLIENT=postgres needs TEST_DATABASE_URL (or DATABASE_URL).");
    const schema = `test_${randomBytes(6).toString("hex")}`;
    const db = createPostgresDatabase({ connectionString, schema, max: 4 });
    await db.raw(`CREATE SCHEMA "${schema}"`);
    await migrate(db, baseConfig.migrationsDir);
    return {
      db,
      async close() {
        await db.raw(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
        await db.close();
      },
    };
  }
  const db = createSqliteDatabase(":memory:", baseConfig.packageRoot);
  await migrate(db, baseConfig.migrationsDir);
  return { db, close: () => db.close() };
}

/** Seeded accounts — every password is "password". */
export const USERS = {
  maya: { uuid: "a1a10000-0000-4000-8000-000000000001", email: "maya@infosoft.ph", name: "Maya Santos", role: "admin" },
  daniel: { uuid: "a1a10000-0000-4000-8000-000000000002", email: "daniel@infosoft.ph", name: "Daniel Reyes", role: "user" },
  priya: { uuid: "a1a10000-0000-4000-8000-000000000003", email: "priya@infosoft.ph", name: "Priya Nair", role: "user" },
  jonas: { uuid: "a1a10000-0000-4000-8000-000000000004", email: "jonas@infosoft.ph", name: "Jonas Lim", role: "user" },
} as const;

/** Seeded projects. */
export const PROJECTS = {
  /** Daniel owner · Maya editor · Priya editor · Jonas viewer */
  portal: "c3c30000-0000-4000-8000-000000000001",
  /** Daniel owner · Priya editor (Jonas has a pending invitation) */
  treasury: "c3c30000-0000-4000-8000-000000000002",
  /** Priya owner · Daniel editor */
  hr: "c3c30000-0000-4000-8000-000000000003",
  /** Daniel owner · Maya editor (completed) */
  permits: "c3c30000-0000-4000-8000-000000000004",
  /** Priya owner · soft-deleted */
  legacy: "c3c30000-0000-4000-8000-000000000005",
} as const;

export const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
export const DEFAULT_TEMPLATE_UUID = "7e7e0000-0000-4000-8000-000000000001";

export class CapturingMailService implements MailService {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
  /** Last message to an address, if any. */
  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === email);
  }
  /** Extracts the first URL in a message body. */
  static link(message: MailMessage | undefined): string | null {
    const match = message?.text.match(/https?:\/\/\S+/);
    return match ? match[0] : null;
  }
}

export interface ApiResult<T = any> {
  status: number;
  body: { success: true; data: T; meta?: Record<string, unknown> } | { success: false; error: { code: string; message: string; fields?: { field: string; message: string }[] } } | null;
  headers: Headers;
  /** Raw response body for non-JSON endpoints (exports). */
  raw: ArrayBuffer;
}

export interface Client {
  call<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>>;
  get<T = any>(path: string, headers?: Record<string, string>): Promise<ApiResult<T>>;
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>>;
  patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>>;
  delete<T = any>(path: string, headers?: Record<string, string>): Promise<ApiResult<T>>;
  login(email: string, password?: string): Promise<ApiResult>;
  /** Current cookie header value (empty when signed out). */
  cookie(): string;
  /** Drop the cookie without calling the API. */
  forget(): void;
}

export interface TestServer {
  baseUrl: string;
  mail: CapturingMailService;
  config: Config;
  /** The isolated database behind the server, for seeders and direct assertions. */
  db: Database;
  /** A fresh client with its own cookie jar; optionally signed in. */
  client(as?: keyof typeof USERS): Promise<Client>;
  close(): Promise<void>;
}

export async function startTestServer(overrides: Partial<Config> = {}, appOptions: Pick<AppOptions, "clerk"> = {}): Promise<TestServer> {
  const { db, close: closeDb } = await openTestDatabase();
  await seedDevelopment(db);

  const config: Config = {
    ...baseConfig,
    env: "test",
    appUrl: ORIGIN,
    allowedOrigins: [ORIGIN],
    // Always the built-in sessions unless a test opts into Clerk — a developer's local `.env` must not change the suite.
    auth: { provider: "session", clerk: { publishableKey: "", secretKey: "", jwtKey: "", clockSkewMs: 60_000 } },
    session: { ...baseConfig.session, secureCookie: false },
    logRequests: false,
    ...overrides,
  };
  const mail = new CapturingMailService();
  const { app } = createApp({ config, db, mail, log: () => {}, ...appOptions });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  const makeClient = (): Client => {
    let cookie = "";
    const call = async <T,>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> => {
      const res = await fetch(baseUrl + path, {
        method,
        headers: {
          Accept: "application/json",
          Origin: ORIGIN,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const [pair] = setCookie.split(";");
        // An expired/empty cookie means "signed out".
        cookie = pair.endsWith("=") ? "" : pair;
      }
      const raw = await res.arrayBuffer();
      let parsed: ApiResult<T>["body"] = null;
      if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        try {
          parsed = JSON.parse(Buffer.from(raw).toString("utf8"));
        } catch {
          parsed = null;
        }
      }
      return { status: res.status, body: parsed, headers: res.headers, raw };
    };
    return {
      call,
      get: (p, h) => call("GET", p, undefined, h),
      post: (p, b = {}, h) => call("POST", p, b, h),
      patch: (p, b, h) => call("PATCH", p, b, h),
      delete: (p, h) => call("DELETE", p, undefined, h),
      login: (email, password = "password") => call("POST", "/auth/login", { email, password }),
      cookie: () => cookie,
      forget: () => {
        cookie = "";
      },
    };
  };

  return {
    baseUrl,
    mail,
    config,
    db,
    async client(as) {
      const c = makeClient();
      if (as) {
        const r = await c.login(USERS[as].email);
        if (r.status !== 200) throw new Error(`Could not sign in as ${as}: ${r.status}`);
      }
      return c;
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await closeDb();
    },
  };
}

/** Narrow an envelope to its data, failing loudly with the error message otherwise. */
export function data<T>(result: ApiResult<T>): T {
  if (!result.body) throw new Error(`Expected a JSON body, got status ${result.status}`);
  if (!result.body.success) throw new Error(`Expected success, got ${result.status} ${result.body.error.code}: ${result.body.error.message}`);
  return result.body.data;
}

/** The error code of a failed envelope (or null). */
export function errorCode(result: ApiResult): string | null {
  return result.body && !result.body.success ? result.body.error.code : null;
}

/** Field names carried by a validation/conflict error. */
export function errorFields(result: ApiResult): string[] {
  return result.body && !result.body.success ? (result.body.error.fields ?? []).map((f) => f.field) : [];
}
