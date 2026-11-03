import { z } from "zod";
import type { SystemRole } from "@scope/contracts";
import type { AuthProvider } from "../../config.ts";
import type { Database } from "../database.ts";
import { repositories } from "../../domain/repositories/index.ts";
import { CLERK_MANAGED_PASSWORD } from "../../domain/services/ClerkAuthService.ts";
import { hashPassword } from "../../domain/services/password.ts";
import { email as emailSchema, parse, password as passwordSchema } from "../../http/validate.ts";

/**
 * Account seeders — the equivalent of Laravel's `AdminSeeder` / `UserSeeder`.
 *
 * Unlike the development fixtures (`dev.ts`) these are safe for any
 * environment, including production: they create one real account each,
 * never touch existing data except to *promote* an account to administrator,
 * and can be re-run at any time.
 *
 *   seedAdmin(db, { name, email, password }, { authProvider })
 *   seedUser(db,  { name, email, password }, { authProvider })
 *
 * Rules:
 * - E-mail is the identity. An existing account (even a soft-deleted one is
 *   left alone — it is not resurrected) is never renamed and its password is
 *   never changed.
 * - `seedAdmin` promotes an existing `user` to `admin`; `seedUser` never
 *   demotes an administrator.
 * - Under the Clerk provider passwords are managed by Clerk, so none is
 *   required; the account gets the non-scrypt sentinel and is linked to a
 *   Clerk identity on first sign-in with the same e-mail (or via `clerk:import`).
 */

export interface AccountSeed {
  name: string;
  email: string;
  /** Required for the session provider, ignored under Clerk. */
  password?: string | null;
}

export interface SeedAccountOptions {
  authProvider: AuthProvider;
  log?: (message: string) => void;
}

export type SeedAccountOutcome = "created" | "promoted" | "unchanged";

export interface SeedAccountResult {
  outcome: SeedAccountOutcome;
  uuid: string;
  email: string;
  role: SystemRole;
}

const accountSeedSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a name of at least 2 characters." }).max(120),
  email: emailSchema,
  password: passwordSchema.nullish(),
});

async function seedAccount(db: Database, seed: AccountSeed, role: SystemRole, options: SeedAccountOptions): Promise<SeedAccountResult> {
  const log = options.log ?? (() => {});
  const input = parse(accountSeedSchema, seed);
  const label = role === "admin" ? "administrator" : "user";
  const repos = repositories(db);

  const existing = await repos.users.findByEmail(input.email);
  if (existing) {
    if (role === "admin" && existing.role !== "admin") {
      await repos.users.updateRole(existing.id, "admin");
      log(`${input.email}: existing account promoted to administrator.`);
      return { outcome: "promoted", uuid: existing.uuid, email: existing.email, role: "admin" };
    }
    log(`${input.email}: account already exists (${existing.role}${existing.disabled_at ? ", disabled" : ""}) — left unchanged.`);
    return { outcome: "unchanged", uuid: existing.uuid, email: existing.email, role: existing.role === "admin" ? "admin" : "user" };
  }

  let passwordHash: string;
  if (options.authProvider === "clerk") {
    if (input.password) log(`${input.email}: AUTH_PROVIDER is clerk — the password is ignored; sign-in is handled by Clerk.`);
    passwordHash = CLERK_MANAGED_PASSWORD;
  } else {
    if (!input.password) throw new SeedAccountError(`A password is required to create the ${label} account ${input.email} with the session provider.`);
    passwordHash = await hashPassword(input.password);
  }

  const row = await repos.users.create({ name: input.name, email: input.email, passwordHash, role });
  log(`${input.email}: ${label} account created.`);
  return { outcome: "created", uuid: row.uuid, email: row.email, role };
}

/** Make sure an administrator account exists for this e-mail (creating or promoting as needed). */
export function seedAdmin(db: Database, seed: AccountSeed, options: SeedAccountOptions): Promise<SeedAccountResult> {
  return seedAccount(db, seed, "admin", options);
}

/** Make sure a regular account exists for this e-mail. Existing accounts — including administrators — are left as they are. */
export function seedUser(db: Database, seed: AccountSeed, options: SeedAccountOptions): Promise<SeedAccountResult> {
  return seedAccount(db, seed, "user", options);
}

/** Operator-facing failure (missing password and the like); the CLI prints the message without a stack trace. */
export class SeedAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedAccountError";
  }
}
