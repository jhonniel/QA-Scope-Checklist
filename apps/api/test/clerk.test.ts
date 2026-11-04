import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Request } from "express";
import type { ClerkDirectory, ClerkIdentity } from "../src/domain/services/ClerkDirectory.ts";
import { ClerkJwtVerifier, frontendApiFromPublishableKey, type ClerkTokenVerifier } from "../src/http/middleware/clerk.ts";
import { data, errorCode, startTestServer, USERS, type Client, type TestServer } from "./helpers.ts";

/**
 * Clerk provider, exercised end to end over HTTP with a deterministic
 * verifier (the "token" is `Bearer <clerkUserId>:<clerkSessionId>`) and an
 * in-memory stand-in for Clerk's Backend API. Everything after verification —
 * linking, provisioning, mirror sessions, disabled accounts, admin revocation —
 * is the real code.
 */

class FakeDirectory implements ClerkDirectory {
  readonly users = new Map<string, ClerkIdentity>();
  readonly revoked: string[] = [];
  readonly created: { externalId: string; email: string; name: string }[] = [];

  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null;
  }
  async createUser(input: { externalId: string; email: string; name: string }) {
    this.created.push(input);
    const identity: ClerkIdentity = { clerkUserId: `user_${this.users.size + 1}`, email: input.email, name: input.name };
    this.users.set(identity.clerkUserId, identity);
    return identity;
  }
  async revokeSessions(id: string) {
    this.revoked.push(id);
  }
}

const verifier: ClerkTokenVerifier = {
  async verify(req: Request) {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const [clerkUserId, clerkSessionId] = header.slice(7).split(":");
    return clerkUserId && clerkSessionId ? { clerkUserId, clerkSessionId } : null;
  },
};

const bearer = (clerkUserId: string, clerkSessionId = `sess_${clerkUserId}`) => ({ Authorization: `Bearer ${clerkUserId}:${clerkSessionId}` });

describe("clerk provider", () => {
  let server: TestServer;
  let anon: Client;
  const directory = new FakeDirectory();
  directory.users.set("user_daniel", { clerkUserId: "user_daniel", email: USERS.daniel.email, name: "Daniel R." });
  directory.users.set("user_new", { clerkUserId: "user_new", email: "newcomer@example.gov.ph", name: "New Comer" });
  directory.users.set("user_noemail", { clerkUserId: "user_noemail", email: null, name: "Ghost" });
  directory.users.set("user_jonas", { clerkUserId: "user_jonas", email: USERS.jonas.email, name: null });
  directory.users.set("user_maya", { clerkUserId: "user_maya", email: USERS.maya.email, name: "Maya Santos" });

  before(async () => {
    server = await startTestServer({ auth: { provider: "clerk", clerk: { publishableKey: "pk_test_x", secretKey: "sk_test_x", jwtKey: "", clockSkewMs: 60_000 } } }, { clerk: { verifier, directory } });
    anon = await server.client();
  });
  after(() => server.close());

  it("advertises the provider and closes the password endpoints", async () => {
    assert.deepEqual(data(await anon.get("/auth/provider")), { provider: "clerk" });
    for (const path of ["/auth/login", "/auth/register", "/auth/password", "/auth/forgot-password", "/auth/reset-password"]) {
      const r = await anon.post(path, { email: USERS.daniel.email, password: "password" });
      assert.equal(r.status, 409, path);
      assert.equal(errorCode(r), "auth_managed_externally");
    }
    // The cookie flow is gone: a seeded password never signs anyone in.
    assert.equal((await anon.get("/auth/me")).status, 401);
  });

  it("links a Clerk user to the existing account with the same e-mail", async () => {
    const me = data(await anon.get("/auth/me", bearer("user_daniel")));
    assert.equal(me.uuid, USERS.daniel.uuid, "matched by e-mail, not re-created");
    assert.equal(me.name, "Daniel Reyes", "local profile wins over the Clerk name");
    assert.equal(me.role, "user");
    assert.ok(!("clerkUserId" in me) && !("id" in me), "no internal identifiers in the response");

    // Projects and memberships are the local ones.
    const projects = data(await anon.get("/projects", bearer("user_daniel")));
    assert.ok(projects.some((p: any) => p.owner.uuid === USERS.daniel.uuid));
  });

  it("provisions a local account for a Clerk user nobody has seen before", async () => {
    const pending = await anon.get("/auth/me", bearer("user_new"));
    assert.equal(pending.status, 401);
    assert.equal(errorCode(pending), "account_pending");

    const waiting = data(await anon.get("/admin/users?status=pending", bearer("user_maya")));
    const created = waiting.find((u: { email: string }) => u.email === "newcomer@example.gov.ph");
    assert.ok(created);
    assert.equal((await anon.post(`/admin/users/${created.uuid}/approve`, {}, bearer("user_maya"))).status, 200);

    const me = data(await anon.get("/auth/me", bearer("user_new")));
    assert.equal(me.email, "newcomer@example.gov.ph");
    assert.equal(me.name, "New Comer");
    assert.equal(me.role, "user", "never an administrator by default");
    assert.equal(data(await anon.get("/projects", bearer("user_new"))).length, 0);

    // Falls back to the e-mail local part when Clerk has no name.
    const jonas = data(await anon.get("/auth/me", bearer("user_jonas")));
    assert.equal(jonas.uuid, USERS.jonas.uuid);

    // A Clerk user without an e-mail cannot be matched to anything.
    const ghost = await anon.get("/auth/me", bearer("user_noemail"));
    assert.equal(ghost.status, 401);
    assert.equal(errorCode(ghost), "unknown_identity");
    // Only the directory lookup happened; no account was created for it.
    assert.equal(directory.created.length, 0);
  });

  it("mirrors each Clerk session so last-seen and session revocation keep working", async () => {
    await anon.get("/auth/me", bearer("user_daniel", "sess_phone"));
    await anon.get("/auth/me", bearer("user_daniel", "sess_laptop"));
    const admin = await anon.get("/admin/users?search=daniel", bearer("user_maya"));
    assert.equal(admin.status, 200);
    assert.ok(data(admin)[0].lastSeenAt, "admin directory shows when the account was last seen");

    // Admin revokes Daniel's sessions: local mirror rows go and Clerk is told to end its sessions.
    assert.equal((await anon.post(`/admin/users/${USERS.daniel.uuid}/revoke-sessions`, {}, bearer("user_maya"))).status, 200);
    assert.deepEqual(directory.revoked, ["user_daniel"]);

    // Revoking your own sessions keeps the current one and does not log you out at Clerk.
    assert.equal((await anon.post(`/admin/users/${USERS.maya.uuid}/revoke-sessions`, {}, bearer("user_maya"))).status, 200);
    assert.deepEqual(directory.revoked, ["user_daniel"]);
    assert.equal((await anon.get("/auth/me", bearer("user_maya"))).status, 200);
  });

  it("refuses disabled accounts even with a valid Clerk token, and ends their Clerk sessions", async () => {
    directory.revoked.length = 0;
    assert.equal((await anon.post(`/admin/users/${USERS.jonas.uuid}/disable`, {}, bearer("user_maya"))).status, 200);
    assert.deepEqual(directory.revoked, ["user_jonas"]);

    const r = await anon.get("/auth/me", bearer("user_jonas", "sess_after_disable"));
    assert.equal(r.status, 401);
    assert.equal(errorCode(r), "account_disabled");

    assert.equal((await anon.post(`/admin/users/${USERS.jonas.uuid}/enable`, {}, bearer("user_maya"))).status, 200);
    assert.equal((await anon.get("/auth/me", bearer("user_jonas"))).status, 200);

    const setPassword = await anon.post(`/admin/users/${USERS.daniel.uuid}/password`, { password: "longenough1" }, bearer("user_maya"));
    assert.equal(setPassword.status, 409);
    assert.equal(errorCode(setPassword), "auth_managed_externally");
  });

  it("signs out by dropping the mirrored session; the next request re-establishes it", async () => {
    assert.equal((await anon.post("/auth/logout", {}, bearer("user_daniel", "sess_x"))).status, 200);
    assert.equal((await anon.get("/auth/me", bearer("user_daniel", "sess_x"))).status, 200, "a still-valid Clerk token is still a valid sign-in");
  });

  it("never lets a mirrored session answer for a different Clerk user", async () => {
    await anon.get("/auth/me", bearer("user_daniel", "sess_shared"));
    const other = data(await anon.get("/auth/me", bearer("user_new", "sess_shared")));
    assert.equal(other.email, "newcomer@example.gov.ph");
  });

  it("ignores malformed or missing bearer tokens", async () => {
    assert.equal((await anon.get("/auth/me", { Authorization: "Bearer nonsense" })).status, 401);
    assert.equal((await anon.get("/auth/me", { Authorization: "Basic abc" })).status, 401);
  });
});

describe("clerk token verification (networkless, CLERK_JWT_KEY)", () => {
  const FRONTEND_API = "example-app-123.clerk.accounts.dev";
  const publishableKey = `pk_test_${Buffer.from(`${FRONTEND_API}$`).toString("base64")}`;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const verifier = new ClerkJwtVerifier({ secretKey: "sk_test_unused", publishableKey, jwtKey: pem, authorizedParties: ["http://app.test"] });

  const b64url = (value: object | Buffer) => (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown>, key = privateKey) => {
    const head = `${b64url({ alg: "RS256", typ: "JWT", kid: "ins_123" })}.${b64url({ iss: `https://${FRONTEND_API}`, sub: "user_abc", sid: "sess_xyz", azp: "http://app.test", iat: now - 5, nbf: now - 5, exp: now + 60, ...claims })}`;
    const signature = createSign("RSA-SHA256").update(head).sign(key);
    return `${head}.${b64url(signature)}`;
  };
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

  it("decodes the Frontend API host from a publishable key", () => {
    assert.equal(frontendApiFromPublishableKey(publishableKey), FRONTEND_API);
    assert.equal(frontendApiFromPublishableKey("pk_live_" + Buffer.from("clerk.example.gov.ph$").toString("base64")), "clerk.example.gov.ph");
    assert.equal(frontendApiFromPublishableKey("sk_test_nope"), null);
    assert.equal(frontendApiFromPublishableKey("pk_test_" + Buffer.from("missing-dollar").toString("base64")), null);
  });

  it("accepts a token signed by the instance key from the header or the __session cookie", async () => {
    const token = sign({});
    assert.deepEqual(await verifier.verify(request({ authorization: `Bearer ${token}` })), { clerkUserId: "user_abc", clerkSessionId: "sess_xyz" });
    assert.deepEqual(await verifier.verify(request({ cookie: `other=1; __session=${token}` })), { clerkUserId: "user_abc", clerkSessionId: "sess_xyz" });
    assert.equal(await verifier.verify(request({})), null);
  });

  it("tolerates configured clock drift and tells the operator when the clock is the problem", async () => {
    const hints: string[] = [];
    const strict = new ClerkJwtVerifier({ secretKey: "sk_test_unused", publishableKey, jwtKey: pem, authorizedParties: ["http://app.test"], clockSkewMs: 5_000, log: (m) => hints.push(m) });
    const lenient = new ClerkJwtVerifier({ secretKey: "sk_test_unused", publishableKey, jwtKey: pem, authorizedParties: ["http://app.test"], clockSkewMs: 60_000, log: (m) => hints.push(m) });
    // A server 30 s behind Clerk sees nbf/iat 30 s in its future — exactly the failure a drifting clock produces.
    const skewed = sign({ iat: now + 30, nbf: now + 30, exp: now + 90 });
    assert.equal(await strict.verify(request({ authorization: `Bearer ${skewed}` })), null);
    assert.equal(hints.length, 1);
    assert.match(hints[0], /server clock is probably off/);
    assert.equal(await strict.verify(request({ authorization: `Bearer ${skewed}` })), null);
    assert.equal(hints.length, 1, "the hint is rate-limited");
    assert.deepEqual(await lenient.verify(request({ authorization: `Bearer ${skewed}` })), { clerkUserId: "user_abc", clerkSessionId: "sess_xyz" });
    // A forged token never produces a clock hint.
    assert.equal(await lenient.verify(request({ authorization: `Bearer ${sign({}, rogue)}` })), null);
    assert.equal(hints.length, 1);
  });

  it("rejects forged, expired, foreign-issuer and foreign-origin tokens", async () => {
    const check = (token: string) => verifier.verify(request({ authorization: `Bearer ${token}` }));
    assert.equal(await check(sign({}, rogue)), null, "signed with another key");
    assert.equal(await check(sign({ exp: now - 120 })), null, "expired");
    assert.equal(await check(sign({ iss: "https://someone-else.clerk.accounts.dev" })), null, "issued by another instance");
    assert.equal(await check(sign({ azp: "https://evil.example" })), null, "token minted for another origin");
    assert.equal(await check(sign({ sid: undefined })), null, "no session id");
    assert.equal(await check("not.a.jwt"), null);
    const [h, p] = sign({}).split(".");
    assert.equal(await check(`${h}.${p}.AAAA`), null, "bad signature");
  });
});

describe("clerk configuration", () => {
  it("is rejected without keys", async () => {
    const { productionConfigProblems, config } = await import("../src/config.ts");
    const problems = productionConfigProblems({ ...config, env: "development", auth: { provider: "clerk", clerk: { publishableKey: "", secretKey: "", jwtKey: "", clockSkewMs: 60_000 } } });
    assert.equal(problems.filter((p) => p.includes("CLERK_")).length, 2);
    const fine = productionConfigProblems({ ...config, env: "development", auth: { provider: "clerk", clerk: { publishableKey: "pk_test_1", secretKey: "sk_test_1", jwtKey: "", clockSkewMs: 60_000 } } });
    assert.equal(fine.filter((p) => p.includes("CLERK_") || p.includes("Clerk")).length, 0);
  });

  it("checks that CLERK_JWT_KEY looks like a PEM public key", async () => {
    const { productionConfigProblems, config } = await import("../src/config.ts");
    const bad = productionConfigProblems({ ...config, env: "development", auth: { provider: "clerk", clerk: { publishableKey: "pk_test_1", secretKey: "sk_test_1", jwtKey: "sk_test_oops", clockSkewMs: 60_000 } } });
    assert.ok(bad.some((p) => p.includes("CLERK_JWT_KEY")));
    const good = productionConfigProblems({ ...config, env: "development", auth: { provider: "clerk", clerk: { publishableKey: "pk_test_1", secretKey: "sk_test_1", jwtKey: "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----", clockSkewMs: 60_000 } } });
    assert.ok(!good.some((p) => p.includes("CLERK_JWT_KEY")));
  });

  it("refuses development keys in production", async () => {
    const { productionConfigProblems, config } = await import("../src/config.ts");
    const problems = productionConfigProblems({ ...config, env: "production", auth: { provider: "clerk", clerk: { publishableKey: "pk_test_1", secretKey: "sk_test_1", jwtKey: "", clockSkewMs: 60_000 } } });
    assert.ok(problems.some((p) => p.includes("development keys")));
  });
});
