import { runAccountSeeder } from "./seed-account.ts";

/** Create a regular user account without going through the public registration form. */
await runAccountSeeder("user");
