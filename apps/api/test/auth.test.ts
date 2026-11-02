import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CapturingMailService, data, errorCode, errorFields, ORIGIN, startTestServer, USERS, type TestServer } from "./helpers.ts";

describe("auth", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("health reports ok", async () => {
    const c = await server.client();
    const r = await c.get("/health");
    assert.equal(r.status, 200);
    assert.deepEqual(data(r), { status: "ok", db: "ok" });
  });

  it("rejects unknown endpoints with the JSON envelope", async () => {
    const c = await server.client();
    const r = await c.get("/nope");
    assert.equal(r.status, 404);
    assert.equal(errorCode(r), "not_found");
  });

  it("signs in with a cookie session and resolves /auth/me", async () => {
    const c = await server.client();
    const r = await c.login(USERS.daniel.email);
    assert.equal(r.status, 200);
    const user = data(r);
    assert.equal(user.uuid, USERS.daniel.uuid);
    assert.equal(user.role, "user");
    assert.ok(!("id" in user) && !("passwordHash" in user), "internal fields must not leak");

    const setCookie = r.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const me = await c.get("/auth/me");
    assert.equal(me.status, 200);
    assert.equal(data(me).email, USERS.daniel.email);
  });

  it("rejects wrong credentials and validates the body", async () => {
    const c = await server.client();
    assert.equal((await c.login(USERS.daniel.email, "nope-nope")).status, 401);
    const bad = await c.post("/auth/login", { email: "not-an-email", password: "" });
    assert.equal(bad.status, 422);
    assert.deepEqual(errorFields(bad).sort(), ["email", "password"]);
  });

  it("throttles repeated failed sign-ins per e-mail", async () => {
    const c = await server.client();
    const target = "throttle@infosoft.ph";
    for (let i = 0; i < 5; i += 1) await c.login(target, "wrong-password");
    const r = await c.login(target, "wrong-password");
    assert.equal(r.status, 429);
  });

  it("requires a session for protected routes and returns 401 with the envelope", async () => {
    const c = await server.client();
    const r = await c.get("/projects");
    assert.equal(r.status, 401);
    assert.equal(errorCode(r), "unauthenticated");
  });

  it("enforces CSRF: state-changing requests need an allowed Origin or X-Requested-With", async () => {
    const c = await server.client("daniel");
    const foreign = await c.post("/projects", { name: "Evil" }, { Origin: "https://evil.example" });
    assert.equal(foreign.status, 403);
    const noOrigin = await c.call("POST", "/projects", { name: "No origin" }, { Origin: "" });
    assert.equal(noOrigin.status, 403);
    const xhr = await c.call("POST", "/projects", { name: "Via XHR header" }, { Origin: "", "X-Requested-With": "XMLHttpRequest" });
    assert.equal(xhr.status, 201);
    // Safe methods are not restricted.
    assert.equal((await c.get("/projects", { Origin: "https://evil.example" })).status, 200);
  });

  it("answers CORS preflight for the allowed origin only", async () => {
    const c = await server.client();
    const ok = await c.call("OPTIONS", "/projects", undefined, { Origin: ORIGIN, "Access-Control-Request-Method": "POST" });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(ok.headers.get("access-control-allow-credentials"), "true");
    const other = await c.call("OPTIONS", "/projects", undefined, { Origin: "https://evil.example" });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  });

  it("sets conservative security headers", async () => {
    const c = await server.client();
    const r = await c.get("/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  it("returns 400 for malformed JSON and 413 for oversized bodies", async () => {
    const c = await server.client("daniel");
    const bad = await c.call("POST", "/projects", "{not json", { "Content-Type": "application/json" });
    assert.equal(bad.status, 400);
    assert.equal(errorCode(bad), "bad_request");
    const huge = await c.post("/projects", { name: "x".repeat(300_000) });
    assert.equal(huge.status, 413);
  });

  it("registers a new account, refuses duplicates and signs the new user in", async () => {
    const c = await server.client();
    const r = await c.post("/auth/register", { name: "New Person", email: "New.Person@Example.com", password: "longenough1" });
    assert.equal(r.status, 201);
    assert.equal(data(r).email, "new.person@example.com", "e-mail is normalised");
    assert.equal(data(r).role, "user");
    assert.equal((await c.get("/auth/me")).status, 200);

    const dup = await c.post("/auth/register", { name: "Again", email: "new.person@example.com", password: "longenough1" });
    assert.equal(dup.status, 409);
    assert.deepEqual(errorFields(dup), ["email"]);

    const weak = await c.post("/auth/register", { name: "A", email: "weak@example.com", password: "short" });
    assert.equal(weak.status, 422);
    assert.deepEqual(errorFields(weak).sort(), ["name", "password"]);
  });

  it("signs out and clears the cookie", async () => {
    const c = await server.client("jonas");
    const out = await c.post("/auth/logout");
    assert.equal(out.status, 200);
    assert.equal(c.cookie(), "");
    assert.equal((await c.get("/auth/me")).status, 401);
  });

  it("updates the profile and refuses an e-mail already in use", async () => {
    const c = await server.client("priya");
    const r = await c.patch("/auth/profile", { name: "Priya N." });
    assert.equal(r.status, 200);
    assert.equal(data(r).name, "Priya N.");
    const clash = await c.patch("/auth/profile", { email: USERS.daniel.email });
    assert.equal(clash.status, 409);
    assert.deepEqual(errorFields(clash), ["email"]);
    assert.equal((await c.patch("/auth/profile", {})).status, 422);
    await c.patch("/auth/profile", { name: USERS.priya.name });
  });

  it("changes the password, revokes other sessions and keeps the current one", async () => {
    const a = await server.client("jonas");
    const b = await server.client("jonas");
    const wrong = await a.post("/auth/password", { currentPassword: "incorrect!", newPassword: "another-password" });
    assert.equal(wrong.status, 422);
    assert.deepEqual(errorFields(wrong), ["currentPassword"]);

    assert.equal((await a.post("/auth/password", { currentPassword: "password", newPassword: "another-password" })).status, 200);
    assert.equal((await a.get("/auth/me")).status, 200, "current session survives");
    assert.equal((await b.get("/auth/me")).status, 401, "other session revoked");
    assert.equal((await b.login(USERS.jonas.email, "password")).status, 401);
    assert.equal((await b.login(USERS.jonas.email, "another-password")).status, 200);
    await b.post("/auth/password", { currentPassword: "another-password", newPassword: "password" });
  });

  it("runs the forgot/reset flow through the mail service without account enumeration", async () => {
    const c = await server.client();
    const before = server.mail.sent.length;
    assert.equal((await c.post("/auth/forgot-password", { email: "nobody@example.com" })).status, 202);
    assert.equal(server.mail.sent.length, before, "unknown addresses get no mail but the same 202");

    assert.equal((await c.post("/auth/forgot-password", { email: USERS.priya.email })).status, 202);
    const link = CapturingMailService.link(server.mail.lastTo(USERS.priya.email));
    assert.ok(link?.startsWith(`${ORIGIN}/reset-password?token=`), `reset link points at the app: ${link}`);
    const token = new URL(link!).searchParams.get("token")!;

    const other = await server.client("priya");
    assert.equal((await c.post("/auth/reset-password", { token, password: "brand-new-pass" })).status, 200);
    assert.equal((await other.get("/auth/me")).status, 401, "every session is revoked after a reset");
    const reuse = await c.post("/auth/reset-password", { token, password: "brand-new-pass2" });
    assert.equal(reuse.status, 400);
    assert.equal(errorCode(reuse), "invalid_token");
    assert.equal((await c.login(USERS.priya.email, "brand-new-pass")).status, 200);
    await c.post("/auth/password", { currentPassword: "brand-new-pass", newPassword: "password" });
  });

  it("rate-limits the public account endpoints per client", async () => {
    const c = await server.client();
    let limited = 0;
    for (let i = 0; i < 25; i += 1) {
      const r = await c.post("/auth/forgot-password", { email: `probe${i}@example.com` });
      if (r.status === 429) limited += 1;
    }
    assert.ok(limited > 0, "forgot-password is rate limited after repeated calls");
    const r = await c.post("/auth/forgot-password", { email: "probe-final@example.com" });
    assert.equal(r.status, 429);
    assert.ok(r.headers.get("retry-after"), "Retry-After header is set");
  });
});
