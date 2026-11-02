import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Database } from "../src/db/database.ts";
import { seedAdmin, seedUser, SeedAccountError } from "../src/db/seeders/accounts.ts";
import { ValidationError } from "../src/domain/errors.ts";
import { repositories } from "../src/domain/repositories/index.ts";
import { CLERK_MANAGED_PASSWORD } from "../src/domain/services/ClerkAuthService.ts";
import { verifyPassword } from "../src/domain/services/password.ts";
import { data, errorCode, openTestDatabase, startTestServer, USERS, type TestServer } from "./helpers.ts";

const session = { authProvider: "session" as const };
const clerk = { authProvider: "clerk" as const };

describe("account seeders (empty database)", () => {
  let db: Database;
  let closeDb: () => Promise<void>;
  before(async () => {
    ({ db, close: closeDb } = await openTestDatabase());
  });
  after(() => closeDb());

  it("creates an administrator with a hashed password and a public uuid", async () => {
    const messages: string[] = [];
    const result = await seedAdmin(db, { name: "  Site Admin ", email: "Admin@Example.gov.ph", password: "correct horse" }, { ...session, log: (m) => messages.push(m) });
    assert.equal(result.outcome, "created");
    assert.equal(result.role, "admin");
    assert.equal(result.email, "admin@example.gov.ph");
    assert.match(result.uuid, /^[0-9a-f-]{36}$/);

    const row = await repositories(db).users.findByEmail("admin@example.gov.ph");
    assert.ok(row);
    assert.equal(row.name, "Site Admin");
    assert.equal(row.role, "admin");
    assert.equal(await verifyPassword("correct horse", row.password_hash), true);
    assert.equal(await verifyPassword("wrong", row.password_hash), false);
    assert.ok(messages.some((m) => m.includes("administrator account created")));
  });

  it("is idempotent — a second run leaves the account, its name and password untouched", async () => {
    const again = await seedAdmin(db, { name: "Someone Else", email: "admin@example.gov.ph", password: "different pass" }, session);
    assert.equal(again.outcome, "unchanged");
    const row = await repositories(db).users.findByEmail("admin@example.gov.ph");
    assert.equal(row?.name, "Site Admin");
    assert.equal(await verifyPassword("correct horse", row!.password_hash), true);
  });

  it("creates a regular user and never demotes an existing administrator", async () => {
    const created = await seedUser(db, { name: "Staff", email: "staff@example.gov.ph", password: "staff-pass-1" }, session);
    assert.equal(created.outcome, "created");
    assert.equal(created.role, "user");

    const admin = await seedUser(db, { name: "Admin", email: "admin@example.gov.ph", password: "whatever-1" }, session);
    assert.equal(admin.outcome, "unchanged");
    assert.equal(admin.role, "admin");
    assert.equal((await repositories(db).users.findByEmail("admin@example.gov.ph"))?.role, "admin");
  });

  it("promotes an existing user to administrator without changing anything else", async () => {
    const promoted = await seedAdmin(db, { name: "Ignored", email: "staff@example.gov.ph" }, session);
    assert.equal(promoted.outcome, "promoted");
    const row = await repositories(db).users.findByEmail("staff@example.gov.ph");
    assert.equal(row?.role, "admin");
    assert.equal(row?.name, "Staff");
    assert.equal(await verifyPassword("staff-pass-1", row!.password_hash), true);
  });

  it("validates input the same way as registration", async () => {
    await assert.rejects(seedUser(db, { name: "A", email: "ok@example.com", password: "longenough1" }, session), (e: unknown) => e instanceof ValidationError && e.fields!.some((f) => f.field === "name"));
    await assert.rejects(seedUser(db, { name: "Fine", email: "not-an-email", password: "longenough1" }, session), (e: unknown) => e instanceof ValidationError && e.fields!.some((f) => f.field === "email"));
    await assert.rejects(seedUser(db, { name: "Fine", email: "short@example.com", password: "short" }, session), (e: unknown) => e instanceof ValidationError && e.fields!.some((f) => f.field === "password"));
    assert.equal(await repositories(db).users.findByEmail("short@example.com"), null);
  });

  it("requires a password with the session provider", async () => {
    await assert.rejects(seedUser(db, { name: "No Password", email: "nopass@example.com" }, session), SeedAccountError);
    assert.equal(await repositories(db).users.findByEmail("nopass@example.com"), null);
  });

  it("needs no password under Clerk and stores a hash the built-in login can never accept", async () => {
    const result = await seedAdmin(db, { name: "Clerk Admin", email: "clerk-admin@example.com" }, clerk);
    assert.equal(result.outcome, "created");
    const row = await repositories(db).users.findByEmail("clerk-admin@example.com");
    assert.equal(row?.password_hash, CLERK_MANAGED_PASSWORD);
    assert.equal(row?.clerk_user_id, null);
    assert.equal(await verifyPassword(CLERK_MANAGED_PASSWORD, row!.password_hash), false);
  });
});

describe("account seeders (running application)", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("lets a seeded administrator sign in and reach the admin area", async () => {
    await seedAdmin(server.db, { name: "Ops Admin", email: "ops@example.gov.ph", password: "ops-password-1" }, session);
    const c = await server.client();
    const login = await c.login("ops@example.gov.ph", "ops-password-1");
    assert.equal(login.status, 200);
    assert.equal(data(login).role, "admin");
    assert.equal((await c.get("/admin/stats")).status, 200);
  });

  it("lets a seeded user sign in but keeps them out of the admin area", async () => {
    await seedUser(server.db, { name: "Field Staff", email: "field@example.gov.ph", password: "field-password-1" }, session);
    const c = await server.client();
    assert.equal((await c.login("field@example.gov.ph", "field-password-1")).status, 200);
    const admin = await c.get("/admin/stats");
    assert.equal(admin.status, 403);
    assert.equal(errorCode(admin), "forbidden");
  });

  it("promotes a seeded fixture account in place", async () => {
    const result = await seedAdmin(server.db, { name: USERS.daniel.name, email: USERS.daniel.email }, session);
    assert.equal(result.outcome, "promoted");
    assert.equal(result.uuid, USERS.daniel.uuid);
    const c = await server.client("daniel");
    assert.equal((await c.get("/admin/stats")).status, 200);
  });
});
