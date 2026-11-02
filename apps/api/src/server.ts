import { createApp } from "./app.ts";
import { config, productionConfigProblems } from "./config.ts";
import { createDatabase } from "./db/index.ts";
import { migrate } from "./db/migrator.ts";

/**
 * Process entry point. Validates the deployment configuration, applies
 * pending migrations, listens, and shuts down cleanly on SIGINT/SIGTERM.
 * Seeding is explicit (`npm run db:seed`) so production data is never touched.
 */
const SHUTDOWN_GRACE_MS = 10_000;

async function main() {
  const problems = productionConfigProblems(config);
  if (problems.length > 0) {
    console.error("[api] refusing to start — fix the configuration:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const db = createDatabase();
  const result = await migrate(db, config.migrationsDir, (m) => console.log(`[db] ${m}`));
  if (result.applied.length > 0) console.log(`[db] applied ${result.applied.length} migration(s)`);

  const { app } = createApp({ config, db });
  const server = app.listen(config.port, () => {
    console.log(`[api] ${config.env} · http://localhost:${config.port}/api · db=${config.db.client}${config.webDist ? ` · web=${config.webDist}` : ""}`);
  });
  // Keep-alive sockets should not outlive a typical proxy idle timeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[api] ${signal} received — draining connections`);
    const timer = setTimeout(() => {
      console.error("[api] forced exit after grace period");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
    server.close(async () => {
      try {
        await db.close();
      } finally {
        process.exit(0);
      }
    });
    server.closeIdleConnections();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    console.error("[api] unhandled rejection", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[api] uncaught exception — shutting down", error);
    shutdown("uncaughtException");
  });
}

main().catch((error) => {
  console.error("[api] failed to start", error);
  process.exit(1);
});
