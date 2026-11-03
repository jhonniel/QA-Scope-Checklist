import { parseArgs } from "node:util";
import type { SystemRole } from "@scope/contracts";
import { config } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { migrate } from "../db/migrator.ts";
import { PRELOADED_ADMIN, seedAdmin, seedUser, SeedAccountError } from "../db/seeders/accounts.ts";
import { DomainError } from "../domain/errors.ts";

/**
 * Shared command line for `db:seed:admin` and `db:seed:user`.
 *
 *   npm run db:seed:admin -w @scope/api -- --email you@example.gov.ph --name "Your Name"
 *   npm run db:seed:user  -w @scope/api -- --email staff@example.gov.ph --name "Staff Member"
 *
 * Values fall back to environment variables (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`,
 * `SEED_ADMIN_PASSWORD` / `SEED_USER_*`). `db:seed:admin` with no arguments
 * creates the preloaded administrator (`admin@qac.poolreno.com` / `Admin1234!`).
 * Safe to re-run: the same e-mail is reused and a provided password is applied.
 */
export async function runAccountSeeder(role: SystemRole): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      password: { type: "string" },
    },
  });

  const prefix = role === "admin" ? "SEED_ADMIN" : "SEED_USER";
  const fromEnv = (key: string) => process.env[`${prefix}_${key}`]?.trim() || undefined;
  const preloaded = role === "admin" ? PRELOADED_ADMIN : null;
  const email = values.email?.trim() || fromEnv("EMAIL") || preloaded?.email;
  const password = values.password || fromEnv("PASSWORD") || preloaded?.password || null;
  if (!email) {
    console.error(`Missing e-mail. Pass --email <address> or set ${prefix}_EMAIL.`);
    process.exit(1);
  }
  const name = values.name?.trim() || fromEnv("NAME") || preloaded?.name || email.split("@")[0];

  const db = createDatabase();
  try {
    await migrate(db, config.migrationsDir);
    const seeder = role === "admin" ? seedAdmin : seedUser;
    const result = await seeder(db, { name, email, password }, { authProvider: config.auth.provider, log: (m) => console.log(m) });
    if (result.outcome === "created" && config.auth.provider === "clerk") {
      console.log("Sign in through Clerk with this e-mail (or run `npm run clerk:import -w @scope/api` to create the Clerk user now).");
    }
    console.log(`${result.outcome}: ${result.email} (${result.role}) uuid=${result.uuid}`);
    if (role === "admin" && email === PRELOADED_ADMIN.email && password === PRELOADED_ADMIN.password) {
      console.log(`Sign in with ${PRELOADED_ADMIN.email} / ${PRELOADED_ADMIN.password} — change this password after first login.`);
    }
  } catch (error) {
    if (error instanceof SeedAccountError) {
      console.error(error.message);
      process.exit(1);
    }
    if (error instanceof DomainError && error.fields) {
      console.error("Invalid input:");
      for (const f of error.fields) console.error(`  - ${f.field}: ${f.message}`);
      process.exit(1);
    }
    throw error;
  } finally {
    await db.close();
  }
}
