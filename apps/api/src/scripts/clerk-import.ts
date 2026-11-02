import { parseArgs } from "node:util";
import { config, productionConfigProblems } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { migrate } from "../db/migrator.ts";
import { seedAdmin } from "../db/seeders/accounts.ts";
import { repositories } from "../domain/repositories/index.ts";
import { ClerkBackendDirectory } from "../domain/services/ClerkDirectory.ts";

/**
 * One-off migration of local accounts into the linked Clerk application.
 *
 *   npm run clerk:import -w @scope/api                 # import every unlinked account
 *   npm run clerk:import -w @scope/api -- --dry-run    # show what would happen
 *   npm run clerk:import -w @scope/api -- --admin you@example.gov.ph
 *
 * For each enabled local account without a `clerk_user_id`: reuse the Clerk
 * user with the same e-mail when one exists, otherwise create one carrying
 * our public uuid as `external_id` and no password (people choose a new one
 * through Clerk's reset flow on first sign-in — scrypt hashes cannot be
 * imported). Nothing local is deleted or renamed; roles and memberships are
 * untouched. Safe to re-run.
 *
 * `--admin <email>` additionally makes sure that e-mail has a local account
 * with the `admin` role, so whoever first signs in through Clerk with it lands
 * as an administrator (useful when the seeded administrator is not a real inbox).
 */
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    admin: { type: "string" },
  },
});

const problems = productionConfigProblems(config);
if (config.auth.provider !== "clerk") problems.unshift("AUTH_PROVIDER is not clerk — link the application first (`npx clerk link --app …` then `npx clerk env pull`).");
if (problems.length > 0) {
  console.error("Cannot import:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const dryRun = values["dry-run"] ?? false;
const directory = new ClerkBackendDirectory(config.auth.clerk);
const db = createDatabase();

try {
  await migrate(db, config.migrationsDir);
  const repos = repositories(db);

  if (values.admin) {
    const email = values.admin.trim().toLowerCase();
    if (dryRun) {
      const existing = await repos.users.findByEmail(email);
      if (!existing) console.log(`[dry-run] would create administrator account for ${email}`);
      else if (existing.role !== "admin") console.log(`[dry-run] would promote ${email} to administrator`);
    } else {
      await seedAdmin(db, { name: email.split("@")[0], email }, { authProvider: config.auth.provider, log: (m) => console.log(m) });
    }
  }

  const pending = (await repos.users.listUnlinked()).filter((u) => !u.disabled_at);
  console.log(`${pending.length} account(s) to link`);
  let linked = 0;
  let created = 0;
  for (const user of pending) {
    const found = await directory.findUserByEmail(user.email);
    if (found) {
      console.log(`${dryRun ? "[dry-run] would link" : "linking"} ${user.email} → existing Clerk user`);
      if (!dryRun) await repos.users.linkClerkUser(user.id, found.clerkUserId);
      linked += 1;
      continue;
    }
    console.log(`${dryRun ? "[dry-run] would create" : "creating"} Clerk user for ${user.email}`);
    if (!dryRun) {
      const identity = await directory.createUser({ externalId: user.uuid, email: user.email, name: user.name });
      await repos.users.linkClerkUser(user.id, identity.clerkUserId);
    }
    created += 1;
  }
  console.log(`done — ${linked} linked to existing Clerk users, ${created} created${dryRun ? " (dry run, nothing written)" : ""}`);
} finally {
  await db.close();
}
