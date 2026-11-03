import { config } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { dropAll, migrate } from "../db/migrator.ts";
import { seedDevelopment } from "../db/seeders/dev.ts";

/** Drop everything, migrate from scratch and seed. Local SQLite only — never a hosted Postgres/MySQL database. */
if (config.env === "production") {
  console.error("Refusing to drop tables in production. Start the API instead — migrations run on boot.");
  process.exit(1);
}
if (config.db.client !== "sqlite") {
  console.error(`db:fresh is for local SQLite only. Refusing to drop the ${config.db.client} database.`);
  console.error("On the server: set the production env (DB_CLIENT=postgres) and run  npm run db:migrate  or start the API.");
  process.exit(1);
}

const db = createDatabase();
try {
  await dropAll(db);
  console.log("Dropped all tables.");
  await migrate(db, config.migrationsDir, (m) => console.log(m));
  await seedDevelopment(db, (m) => console.log(m));
} finally {
  await db.close();
}
