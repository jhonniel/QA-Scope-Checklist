import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProductivityWeights, type ProductivityWeights } from "@scope/contracts";

/**
 * Runtime configuration, read once from the environment. Defaults favour a
 * zero-install developer experience (SQLite file, no secrets) and must be
 * overridden in production.
 */

export type DbClient = "sqlite" | "mysql" | "postgres";
export type DbSsl = false | true | "no-verify";

/**
 * Who authenticates users.
 * - `session`: the built-in e-mail + password flow with the httpOnly session cookie (default).
 * - `clerk`: Clerk hosts sign-in/sign-up; the API verifies Clerk session tokens and maps them to local accounts.
 */
export type AuthProvider = "session" | "clerk";

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  /** Public URL of the web app; used in password-reset links. */
  appUrl: string;
  /** Origins allowed to call the API with credentials (CORS + CSRF check). */
  allowedOrigins: string[];
  db: {
    client: DbClient;
    /** SQLite only. Relative paths resolve against the API package root. */
    file: string;
    /** MySQL and PostgreSQL. */
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    /** PostgreSQL only: `DATABASE_URL` style connection string; when set it wins over the discrete fields. */
    url: string;
    /** PostgreSQL only: `DB_SSL` = false | true | no-verify (managed hosts with self-signed certificates). */
    ssl: DbSsl;
  };
  auth: {
    provider: AuthProvider;
    clerk: {
      /** Public key; also shipped to the browser as VITE_CLERK_PUBLISHABLE_KEY. */
      publishableKey: string;
      /** Server-only. Never logged, never returned by any endpoint. */
      secretKey: string;
      /**
       * Optional PEM public key of the instance (Dashboard → API keys → "JWT public key").
       * When set, session tokens are verified locally without fetching the JWKS.
       */
      jwtKey: string;
      /**
       * Tolerance for the server clock being off when checking `nbf`/`exp`
       * (Clerk's own default is 5 s, which a few seconds of drift already breaks).
       */
      clockSkewMs: number;
    };
  };
  session: {
    cookieName: string;
    /** Idle lifetime; refreshed on every authenticated request. */
    ttlDays: number;
    secureCookie: boolean;
  };
  passwordReset: {
    ttlMinutes: number;
  };
  export: {
    /** IANA zone for timestamps in generated documents when the client sends none. */
    defaultTimeZone: string;
  };
  productivity: {
    /** Points per activity bucket for the admin productivity ranking (`PRODUCTIVITY_WEIGHTS`, e.g. `tasksCompleted=8,comments=2`). */
    weights: ProductivityWeights;
  };
  /** Absolute path of the directory holding *.sql migrations. */
  migrationsDir: string;
  /** Absolute path of the API package root. */
  packageRoot: string;
  /** Directory of the built web app to serve from this process, or null when hosted elsewhere. */
  webDist: string | null;
  /** Write one log line per request (off in tests). */
  logRequests: boolean;
  /** Number of proxies in front of the API (`trust proxy`); 0 when exposed directly. */
  trustProxy: number;
}

/** Walk up from this file until the @scope/api package.json is found. Works from src/, dist/ and dist/scripts/. */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name === "@scope/api") return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate the @scope/api package root");
}

/**
 * Load `apps/api/.env` into `process.env` when present, without overriding
 * variables already set by the shell or the host. Uses Node's built-in loader
 * so no dependency is needed; `clerk env pull` and hand-edited files both land here.
 */
function loadDotEnv(packageRoot: string): void {
  const file = join(packageRoot, ".env");
  if (!existsSync(file) || typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(file);
  } catch {
    /* unreadable or malformed .env — the explicit environment still applies */
  }
}

const env = (key: string, fallback: string): string => process.env[key] ?? fallback;
const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const value = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
};

/** Settings that could not be parsed; reported by `productionConfigProblems` in every environment. */
const invalidSettings: string[] = [];

function productivityWeights(): ProductivityWeights {
  try {
    return parseProductivityWeights(process.env.PRODUCTIVITY_WEIGHTS);
  } catch (error) {
    invalidSettings.push(error instanceof Error ? error.message : String(error));
    return parseProductivityWeights(undefined);
  }
}

/** Accepts a PEM pasted with real line breaks, quoted `\n` escapes, or on one line. */
function pem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

function authProvider(): AuthProvider {
  const raw = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  if (raw === "clerk" || raw === "session") return raw;
  if (raw) invalidSettings.push(`AUTH_PROVIDER must be "session" or "clerk" (got "${raw}").`);
  // Unset: Clerk keys present means Clerk was linked with `clerk env pull`; otherwise the built-in sessions.
  return process.env.CLERK_SECRET_KEY ? "clerk" : "session";
}

function dbClient(): DbClient {
  const raw = env("DB_CLIENT", "sqlite").toLowerCase();
  if (raw === "sqlite" || raw === "mysql" || raw === "postgres") return raw;
  if (raw === "pg" || raw === "postgresql") return "postgres";
  if (raw === "mariadb") return "mysql";
  invalidSettings.push(`DB_CLIENT must be "sqlite", "mysql" or "postgres" (got "${raw}").`);
  return "sqlite";
}

function dbSsl(): DbSsl {
  const raw = env("DB_SSL", "false").toLowerCase();
  if (raw === "" || raw === "false" || raw === "0" || raw === "disable") return false;
  if (raw === "true" || raw === "1" || raw === "require" || raw === "verify-full") return true;
  if (raw === "no-verify") return "no-verify";
  invalidSettings.push(`DB_SSL must be "false", "true" or "no-verify" (got "${raw}").`);
  return false;
}

export function loadConfig(): Config {
  const packageRoot = findPackageRoot();
  const client = dbClient();
  loadDotEnv(packageRoot);
  const nodeEnv = env("NODE_ENV", "development");
  const appUrl = env("APP_URL", "http://localhost:5173");
  return {
    env: nodeEnv === "production" ? "production" : nodeEnv === "test" ? "test" : "development",
    port: int("PORT", 4000),
    appUrl,
    allowedOrigins: env("ALLOWED_ORIGINS", appUrl)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    db: {
      client,
      file: env("DB_FILE", "storage/scope.sqlite"),
      host: env("DB_HOST", "127.0.0.1"),
      port: int("DB_PORT", client === "postgres" ? 5432 : 3306),
      user: env("DB_USER", client === "postgres" ? "postgres" : "root"),
      password: env("DB_PASSWORD", ""),
      database: env("DB_DATABASE", "scope_checklist"),
      url: env("DATABASE_URL", ""),
      ssl: dbSsl(),
    },
    auth: {
      provider: authProvider(),
      clerk: {
        publishableKey: env("CLERK_PUBLISHABLE_KEY", ""),
        secretKey: env("CLERK_SECRET_KEY", ""),
        jwtKey: pem(env("CLERK_JWT_KEY", "")),
        clockSkewMs: int("CLERK_CLOCK_SKEW_MS", 60_000),
      },
    },
    session: {
      cookieName: env("SESSION_COOKIE", "scope_session"),
      ttlDays: int("SESSION_TTL_DAYS", 14),
      secureCookie: env("SESSION_SECURE", nodeEnv === "production" ? "true" : "false") === "true",
    },
    passwordReset: {
      ttlMinutes: int("PASSWORD_RESET_TTL_MINUTES", 60),
    },
    export: {
      defaultTimeZone: env("EXPORT_TIMEZONE", "Asia/Manila"),
    },
    productivity: {
      // A malformed value is reported at start-up (see productionConfigProblems) instead of silently skewing the ranking.
      weights: productivityWeights(),
    },
    migrationsDir: join(packageRoot, "db", "migrations"),
    packageRoot,
    webDist: process.env.WEB_DIST ? resolve(packageRoot, process.env.WEB_DIST) : null,
    logRequests: env("LOG_REQUESTS", nodeEnv === "test" ? "false" : "true") === "true",
    trustProxy: int("TRUST_PROXY", 1),
  };
}

/**
 * Start-up sanity checks. Returns human-readable problems; the server refuses
 * to start when any are present. Unparseable settings are reported in every
 * environment; the deployment checks (plain-HTTP cookies, localhost links in
 * e-mails, throwaway SQLite file) only in production so a misconfigured
 * instance never serves real users.
 */
export function productionConfigProblems(cfg: Config): string[] {
  const problems: string[] = [...invalidSettings];
  if (cfg.auth.provider === "clerk") {
    if (!cfg.auth.clerk.secretKey) problems.push("AUTH_PROVIDER=clerk needs CLERK_SECRET_KEY (run `npx clerk env pull` in apps/api).");
    if (!cfg.auth.clerk.publishableKey) problems.push("AUTH_PROVIDER=clerk needs CLERK_PUBLISHABLE_KEY (run `npx clerk env pull` in apps/api).");
    if (cfg.auth.clerk.clockSkewMs < 0 || cfg.auth.clerk.clockSkewMs > 300_000) {
      problems.push("CLERK_CLOCK_SKEW_MS must be between 0 and 300000 (5 minutes) — fix the server clock rather than widening this.");
    }
    if (cfg.auth.clerk.jwtKey && !/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(cfg.auth.clerk.jwtKey)) {
      problems.push("CLERK_JWT_KEY is not a PEM public key (copy the \"JWT public key\" from the Clerk Dashboard → API keys).");
    }
    if (cfg.env === "production" && /^(pk|sk)_test_/.test(cfg.auth.clerk.secretKey + cfg.auth.clerk.publishableKey)) {
      problems.push("Clerk development keys (pk_test_/sk_test_) are set in production — pull the production instance keys.");
    }
  }
  if (cfg.env !== "production") return problems;
  // Transport checks can be waived for a local docker-compose trial (plain http on localhost); never for real users.
  if (process.env.ALLOW_INSECURE_PRODUCTION !== "true") {
    if (!/^https:\/\//.test(cfg.appUrl)) problems.push("APP_URL must be an https:// URL in production (it is embedded in e-mails and used for CSRF).");
    if (cfg.allowedOrigins.some((o) => /localhost|127\.0\.0\.1/.test(o))) problems.push("ALLOWED_ORIGINS still contains a localhost origin.");
    if (!cfg.session.secureCookie) problems.push("SESSION_SECURE must be true in production so the session cookie is only sent over HTTPS.");
  }
  if (cfg.db.client === "mysql" && !cfg.db.password) problems.push("DB_PASSWORD is empty.");
  if (cfg.db.client === "postgres" && !cfg.db.url && !cfg.db.password) problems.push("DB_PASSWORD is empty (or set DATABASE_URL).");
  if (cfg.db.client === "sqlite" && process.env.ALLOW_SQLITE_IN_PRODUCTION !== "true") {
    problems.push("DB_CLIENT=sqlite in production — use MySQL/MariaDB or PostgreSQL, or set ALLOW_SQLITE_IN_PRODUCTION=true for a single-user pilot.");
  }
  return problems;
}

export const config: Config = loadConfig();
