import { config } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { dropAll, migrate } from "../db/migrator.ts";
import { seedDevelopment } from "../db/seeders/dev.ts";

/** Drop everything, migrate from scratch and seed. Development only — equivalent of `migrate:fresh --seed`. */
if (config.env === "production") {
  console.error("Refusing to drop tables in production.");
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
