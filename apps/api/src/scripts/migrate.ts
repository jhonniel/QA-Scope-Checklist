import { config } from "../config.ts";
import { createDatabase } from "../db/index.ts";
import { migrate } from "../db/migrator.ts";

const db = createDatabase();
try {
  const result = await migrate(db, config.migrationsDir, (m) => console.log(m));
  console.log(`Applied ${result.applied.length}, already up to date ${result.skipped.length} (${config.db.client}).`);
} finally {
  await db.close();
}
