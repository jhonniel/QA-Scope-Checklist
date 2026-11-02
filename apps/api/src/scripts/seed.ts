import { config } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { migrate } from "../db/migrator.ts";
import { seedDevelopment } from "../db/seeders/dev.ts";

if (config.env === "production") {
  console.error("Refusing to seed development fixtures in production.");
  process.exit(1);
}

const db = createDatabase();
try {
  await migrate(db, config.migrationsDir);
  await seedDevelopment(db, (m) => console.log(m));
} finally {
  await db.close();
}
