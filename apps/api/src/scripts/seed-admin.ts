import { runAccountSeeder } from "./seed-account.ts";

/** Create (or promote) an administrator account — the first-boot bootstrap for a real deployment. */
await runAccountSeeder("admin");
