import { join } from "node:path";
import express, { type Express } from "express";
import type { Config } from "./config.ts";
import type { Database } from "./db/database.ts";
import { ActivityService } from "./domain/services/ActivityService.ts";
import { AdminService } from "./domain/services/AdminService.ts";
import { AuthService } from "./domain/services/AuthService.ts";
import { ChecklistService } from "./domain/services/ChecklistService.ts";
import { ClerkAuthService } from "./domain/services/ClerkAuthService.ts";
import { ClerkBackendDirectory, type ClerkDirectory } from "./domain/services/ClerkDirectory.ts";
import { DocxDocumentGenerator } from "./domain/export/DocumentGenerator.ts";
import { ErrorLogService } from "./domain/services/ErrorLogService.ts";
import { ExportService } from "./domain/services/ExportService.ts";
import { ConsoleMailService, type MailService } from "./domain/services/MailService.ts";
import { MembershipService } from "./domain/services/MembershipService.ts";
import { ProjectService } from "./domain/services/ProjectService.ts";
import { ShareService } from "./domain/services/ShareService.ts";
import type { Services } from "./http/context.ts";
import { ClerkJwtVerifier, clerkSessionMiddleware, type ClerkTokenVerifier } from "./http/middleware/clerk.ts";
import { errorHandler, notFound } from "./http/middleware/errors.ts";
import { cors, originGuard, requestLogger, securityHeaders } from "./http/middleware/security.ts";
import { sessionMiddleware } from "./http/middleware/session.ts";
import { serveWebApp } from "./http/middleware/static.ts";
import { buildRouter } from "./http/routes.ts";

export interface AppOptions {
  config: Config;
  db: Database;
  mail?: MailService;
  log?: (message: string, error?: unknown) => void;
  /** Clerk integration points (only read when `config.auth.provider === "clerk"`); tests inject fakes. */
  clerk?: { verifier: ClerkTokenVerifier; directory: ClerkDirectory };
}

/** Wire services and middleware. Kept separate from `server.ts` so tests can mount the app without listening. */
export function createApp({ config, db, mail = new ConsoleMailService(), log = console.error, clerk }: AppOptions): { app: Express; services: Services } {
  const projects = new ProjectService(db);
  const sessionTtlMs = config.session.ttlDays * 86_400_000;
  const auth = new AuthService(db, {
    sessionTtlMs,
    resetTtlMs: config.passwordReset.ttlMinutes * 60_000,
    appUrl: config.appUrl,
    mail,
  });

  // Clerk: token verification + the Backend API behind interfaces; the SDK is only constructed when selected.
  let clerkAuth: ClerkAuthService | null = null;
  let clerkVerifier: ClerkTokenVerifier | null = null;
  if (config.auth.provider === "clerk") {
    const directory = clerk?.directory ?? new ClerkBackendDirectory(config.auth.clerk);
    clerkVerifier =
      clerk?.verifier ??
      new ClerkJwtVerifier({ ...config.auth.clerk, authorizedParties: [...new Set([config.appUrl, ...config.allowedOrigins].map((o) => o.replace(/\/$/, "")))], log });
    clerkAuth = new ClerkAuthService(db, directory, { sessionTtlMs });
  }

  const services: Services = {
    auth,
    clerkAuth,
    projects,
    checklist: new ChecklistService(db, projects),
    activity: new ActivityService(db, projects),
    membership: new MembershipService(db, projects, { appUrl: config.appUrl, mail }),
    exports: new ExportService(db, projects, new DocxDocumentGenerator({ assetsDir: join(config.packageRoot, "assets"), log }), { defaultTimeZone: config.export.defaultTimeZone }),
    admin: new AdminService(db, auth, {
      productivityWeights: config.productivity.weights,
      revokeExternalSessions: clerkAuth ? (user) => clerkAuth.revokeClerkSessions(user) : undefined,
      passwordsManagedExternally: Boolean(clerkAuth),
    }),
    errors: new ErrorLogService(db, log),
    share: new ShareService(db, projects),
  };

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  if (config.logRequests) app.use(requestLogger((line) => console.log(`[http] ${line}`)));
  app.use(securityHeaders(config));
  app.use(cors(config));
  app.use(express.json({ limit: "256kb" }));
  app.use(originGuard(config));
  // Exactly one principal resolver: the cookie session or the Clerk token, never both.
  if (clerkAuth && clerkVerifier) app.use("/api", clerkSessionMiddleware(clerkVerifier, clerkAuth));
  else app.use(sessionMiddleware(services.auth, config));
  app.use("/api", buildRouter(services, config, { ping: () => db.queryOne("SELECT 1 AS ok") }));
  // Optional: the built SPA from the same process (see http/middleware/static.ts).
  if (config.webDist) serveWebApp(app, config.webDist);
  app.use(notFound);
  app.use(
    errorHandler({
      log: (message, error) => log(message, error),
      // Every 5xx is kept for Admin → Errors; the response itself stays generic.
      record: (caught) =>
        services.errors.record({
          source: "api",
          status: caught.status,
          code: caught.code,
          message: caught.message,
          stack: caught.stack,
          method: caught.method,
          path: caught.path,
          actorId: caught.actorId,
          userAgent: caught.userAgent,
          context: caught.name ? { name: caught.name } : null,
        }),
    }),
  );

  return { app, services };
}
