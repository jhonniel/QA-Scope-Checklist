import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PRODUCTIVITY_WEIGHTS, productivityScore } from "@scope/contracts";
import { data, errorCode, errorFields, PROJECTS, startTestServer, UNKNOWN_UUID, USERS, type Client, type TestServer } from "./helpers.ts";

describe("administration", () => {
  let server: TestServer;
  let maya: Client;
  let daniel: Client;

  before(async () => {
    server = await startTestServer();
    [maya, daniel] = await Promise.all([server.client("maya"), server.client("daniel")]);
  });
  after(() => server.close());

  it("is closed to anonymous callers and non-admins", async () => {
    const anon = await server.client();
    assert.equal((await anon.get("/admin/stats")).status, 401);
    for (const path of ["/admin/stats", "/admin/users", "/admin/projects", "/admin/audit", "/admin/errors", `/admin/errors/${UNKNOWN_UUID}`]) {
      const r = await daniel.get(path);
      assert.equal(r.status, 403, path);
      assert.equal(errorCode(r), "forbidden");
    }
    assert.equal((await daniel.post(`/admin/users/${USERS.jonas.uuid}/disable`)).status, 403);
    assert.equal((await daniel.post(`/admin/projects/${PROJECTS.legacy}/restore`)).status, 403);
  });

  it("reports system statistics", async () => {
    const s = data(await maya.get("/admin/stats"));
    assert.equal(s.users.total, 4);
    assert.equal(s.users.admins, 1);
    assert.equal(s.users.disabled, 0);
    assert.equal(s.projects.total, 4);
    assert.equal(s.projects.deleted, 1);
    assert.equal(s.projects.completed, 1);
    assert.equal(s.tasks.total, 47);
    assert.equal(
      Object.values(s.tasks.byStatus as Record<string, number>).reduce((a, b) => a + b, 0),
      47,
    );
    assert.equal(s.collaboration.pendingInvitations, 2);
    assert.equal(s.collaboration.comments, 5);
    assert.equal(s.exports.total, 1);
    assert.deepEqual(s.errors, { total: 0, last24Hours: 0, last7Days: 0 });
    assert.equal(typeof s.generatedAt, "string");
  });

  describe("error log", () => {
    it("accepts crash reports from the web app, signed in or not, and lists them for admins", async () => {
      const anon = await server.client();
      const anonymous = await anon.post("/errors", { message: "Cannot read properties of undefined (reading 'uuid')", name: "TypeError", stack: "TypeError: boom\n    at SectionPage", path: "/projects/x" });
      assert.equal(anonymous.status, 202, "anonymous reports are accepted");

      const signedIn = await daniel.post("/errors", { message: "Render failed in dashboard", context: { kind: "route" } });
      assert.equal(signedIn.status, 202);

      // Only admins may read them.
      assert.equal((await daniel.get("/admin/errors")).status, 403);

      const list = await maya.get("/admin/errors");
      assert.equal(list.status, 200);
      assert.equal((list.body as any).meta.total, 2);
      const [newest, oldest] = data(list);
      assert.equal(newest.message, "Render failed in dashboard", "newest first");
      assert.equal(newest.source, "web");
      assert.equal(newest.status, null);
      assert.equal(newest.actor.uuid, USERS.daniel.uuid);
      assert.deepEqual(newest.context, { kind: "route" });
      assert.equal(oldest.actor, null);
      assert.equal(oldest.code, "TypeError");
      assert.equal(oldest.path, "/projects/x");
      assert.match(oldest.stack, /SectionPage/);
      for (const e of data(list)) {
        assert.ok(!("id" in e) && !("actorId" in e) && !("actor_id" in e), "no internal ids leak");
        assert.match(e.uuid, /^[0-9a-f-]{36}$/);
      }

      // Filters and search.
      assert.equal(data(await maya.get("/admin/errors?source=api")).length, 0);
      assert.equal(data(await maya.get("/admin/errors?source=web")).length, 2);
      assert.equal(data(await maya.get("/admin/errors?search=dashboard")).length, 1);
      assert.equal(data(await maya.get("/admin/errors?search=TypeError")).length, 1, "search matches the code too");
      assert.equal((await maya.get("/admin/errors?source=mainframe")).status, 422);

      // Detail.
      const detail = await maya.get(`/admin/errors/${oldest.uuid}`);
      assert.equal(detail.status, 200);
      assert.equal(data(detail).uuid, oldest.uuid);
      assert.equal((await maya.get(`/admin/errors/${UNKNOWN_UUID}`)).status, 404);
      assert.equal((await maya.get(`/admin/errors/not-a-uuid`)).status, 422);

      // Counts feed the overview.
      const stats = data(await maya.get("/admin/stats"));
      assert.deepEqual(stats.errors, { total: 2, last24Hours: 2, last7Days: 2 });
    });

    it("rejects malformed crash reports", async () => {
      assert.equal((await daniel.post("/errors", { message: "" })).status, 422);
      assert.equal((await daniel.post("/errors", { message: "x", secret: "nope" })).status, 422, "unknown keys are refused");
      assert.equal((await daniel.post("/errors", { message: "x".repeat(2001) })).status, 422);
    });
  });

  it("pages, searches and filters the user directory without leaking internals", async () => {
    const all = await maya.get("/admin/users");
    assert.equal(all.status, 200);
    assert.equal((all.body as any).meta.total, 4);
    for (const u of data(all)) {
      assert.ok(!("id" in u) && !("passwordHash" in u) && !("password_hash" in u));
      assert.ok("disabledAt" in u && "lastSeenAt" in u && "ownedProjects" in u && "memberships" in u);
    }
    const danielRow = data(all).find((u: any) => u.uuid === USERS.daniel.uuid);
    assert.equal(danielRow.ownedProjects, 3);
    assert.equal(danielRow.memberships, 4);

    assert.equal(data(await maya.get("/admin/users?search=jonas")).length, 1);
    assert.equal(data(await maya.get("/admin/users?role=admin"))[0].uuid, USERS.maya.uuid);
    assert.equal(data(await maya.get("/admin/users?status=disabled")).length, 0);
    const page2 = await maya.get("/admin/users?perPage=3&page=2");
    assert.equal(data(page2).length, 1);
    assert.equal((page2.body as any).meta.totalPages, 2);
    assert.equal((await maya.get("/admin/users?role=bogus")).status, 422);
    assert.equal((await maya.get("/admin/users?perPage=500")).status, 422);
  });

  it("changes roles with the self and last-admin protections", async () => {
    assert.equal((await maya.patch(`/admin/users/${USERS.maya.uuid}`, { role: "user" })).status, 409, "own role");

    const promoted = data(await maya.patch(`/admin/users/${USERS.daniel.uuid}`, { role: "admin" }));
    assert.equal(promoted.role, "admin");
    assert.equal((await daniel.get("/admin/stats")).status, 200, "existing session gains admin access immediately");

    assert.equal((await daniel.patch(`/admin/users/${USERS.maya.uuid}`, { role: "user" })).status, 200, "another admin remains");
    assert.equal((await maya.get("/admin/stats")).status, 403);
    assert.equal((await daniel.patch(`/admin/users/${USERS.daniel.uuid}`, { role: "user" })).status, 409, "last admin cannot demote himself");

    assert.equal((await daniel.patch(`/admin/users/${USERS.maya.uuid}`, { role: "admin" })).status, 200);
    assert.equal((await maya.patch(`/admin/users/${USERS.daniel.uuid}`, { role: "user" })).status, 200);
    assert.equal((await daniel.get("/admin/stats")).status, 403);

    const audit = data(await maya.get("/admin/audit?perPage=50"));
    const changes = audit.filter((a: any) => a.action === "user.role_changed" && a.targetUuid === USERS.daniel.uuid).map((a: any) => a.meta);
    assert.deepEqual(changes, [
      { from: "admin", to: "user" },
      { from: "user", to: "admin" },
    ]);
  });

  it("edits account details with validation", async () => {
    const clash = await maya.patch(`/admin/users/${USERS.jonas.uuid}`, { email: USERS.daniel.email });
    assert.equal(clash.status, 409);
    assert.deepEqual(errorFields(clash), ["email"]);
    assert.equal((await maya.patch(`/admin/users/${USERS.jonas.uuid}`, { nope: 1 })).status, 422);
    assert.equal((await maya.patch(`/admin/users/${USERS.jonas.uuid}`, {})).status, 422);
    assert.equal(data(await maya.patch(`/admin/users/${USERS.jonas.uuid}`, { name: "Jonas B. Lim" })).name, "Jonas B. Lim");
    assert.equal((await maya.patch(`/admin/users/${UNKNOWN_UUID}`, { name: "Nobody" })).status, 404);
  });

  it("disables and re-enables accounts, revoking access in between", async () => {
    const jonas = await server.client("jonas");
    assert.equal((await maya.post(`/admin/users/${USERS.maya.uuid}/disable`)).status, 409, "cannot disable yourself");

    const disabled = data(await maya.post(`/admin/users/${USERS.jonas.uuid}/disable`));
    assert.ok(disabled.disabledAt);
    assert.equal((await jonas.get("/auth/me")).status, 401, "existing session revoked");
    const login = await jonas.login(USERS.jonas.email);
    assert.equal(login.status, 403);
    assert.equal(errorCode(login), "account_disabled");
    assert.equal(data(await maya.get("/admin/users?status=disabled"))[0].uuid, USERS.jonas.uuid);
    assert.equal(data(await maya.get("/admin/stats")).users.disabled, 1);
    assert.equal((await maya.post(`/admin/users/${USERS.jonas.uuid}/password-reset`)).status, 409);

    const before = server.mail.sent.length;
    const anon = await server.client();
    assert.equal((await anon.post("/auth/forgot-password", { email: USERS.jonas.email })).status, 202);
    assert.equal(server.mail.sent.length, before, "no reset mail for disabled accounts, same 202");

    assert.equal(data(await maya.post(`/admin/users/${USERS.jonas.uuid}/enable`)).disabledAt, null);
    assert.equal((await jonas.login(USERS.jonas.email)).status, 200);
    assert.equal((await maya.post(`/admin/users/${USERS.jonas.uuid}/password-reset`)).status, 202);
    assert.ok(server.mail.lastTo(USERS.jonas.email), "reset mail sent by the admin");
  });

  it("revokes sessions but keeps the caller's current one", async () => {
    const other = await server.client("daniel");
    assert.equal((await maya.post(`/admin/users/${USERS.daniel.uuid}/revoke-sessions`)).status, 200);
    assert.equal((await other.get("/auth/me")).status, 401);
    daniel = await server.client("daniel");
    assert.equal((await maya.post(`/admin/users/${USERS.maya.uuid}/revoke-sessions`)).status, 200);
    assert.equal((await maya.get("/auth/me")).status, 200);
  });

  it("lists every project including the deleted ones and restores them", async () => {
    const live = await maya.get("/admin/projects");
    assert.equal((live.body as any).meta.total, 4);
    assert.ok(data(live).every((p: any) => p.deletedAt === null));
    assert.ok(!("id" in data(live)[0]));

    const deleted = data(await maya.get("/admin/projects?status=deleted"));
    assert.equal(deleted.length, 1);
    assert.equal(deleted[0].uuid, PROJECTS.legacy);
    assert.ok(deleted[0].deletedAt);
    assert.equal(data(await maya.get("/admin/projects?status=completed")).length, 1);
    assert.equal(data(await maya.get("/admin/projects?search=priya"))[0].owner.uuid, USERS.priya.uuid);
    assert.equal((await maya.get("/admin/projects?status=bogus")).status, 422);

    const priya = await server.client("priya");
    assert.ok(!data(await priya.get("/projects")).some((p: any) => p.uuid === PROJECTS.legacy));

    const restored = await maya.post(`/admin/projects/${PROJECTS.legacy}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(data(restored).deletedAt, null);
    assert.ok(data(await priya.get("/projects")).some((p: any) => p.uuid === PROJECTS.legacy), "owner sees it again");
    const activity = data(await maya.get(`/activity?project=${PROJECTS.legacy}&type=project&page=1&perPage=5`));
    assert.ok(activity.some((a: any) => a.action === "project.restored"));
    assert.equal((await maya.post(`/admin/projects/${PROJECTS.legacy}/restore`)).status, 409);
    assert.equal((await maya.post(`/admin/projects/${UNKNOWN_UUID}/restore`)).status, 404);
  });

  it("keeps an append-only audit log with paging", async () => {
    const all = await maya.get("/admin/audit?perPage=50");
    assert.equal(all.status, 200);
    const actions = data(all).map((a: any) => a.action);
    for (const expected of ["user.role_changed", "user.updated", "user.disabled", "user.enabled", "user.password_reset_sent", "user.sessions_revoked", "project.restored"]) {
      assert.ok(actions.includes(expected), expected);
    }
    const entry = data(all)[0];
    assert.ok(entry.actor?.uuid && entry.uuid && ["user", "project"].includes(entry.targetType));
    assert.ok(!("id" in entry) && !("actorId" in entry));
    const page = await maya.get("/admin/audit?perPage=4&page=2");
    assert.equal((page.body as any).meta.page, 2);
    assert.equal(data(page).length, 4);
  });

  it("ranks users by weighted activity and reacts to new work", async () => {
    assert.equal((await daniel.get("/admin/productivity")).status, 403);
    assert.equal((await maya.get("/admin/productivity?period=1y")).status, 422);

    const before = data(await maya.get("/admin/productivity?period=all"));
    assert.equal(before.period, "all");
    assert.equal(before.since, null);
    assert.equal(before.entries.length, 4, "every account is listed, active or not");
    for (const entry of before.entries) {
      assert.ok(!("id" in entry.user) && !("actorId" in entry), "no internal identifiers");
      assert.equal(entry.score, productivityScore(entry.counts), "score is the weighted sum of the buckets");
      assert.equal(
        entry.totalActions,
        Object.values(entry.counts as Record<string, number>).reduce((a, b) => a + b, 0),
      );
    }
    const scores = before.entries.map((e: any) => e.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "sorted by score, highest first");
    assert.equal(before.totals.score, scores.reduce((a: number, b: number) => a + b, 0));
    assert.equal(before.totals.activeUsers, before.entries.filter((e: any) => e.totalActions > 0).length);
    const idleJonas = before.entries.find((e: any) => e.user.uuid === USERS.jonas.uuid);
    assert.equal(idleJonas.totalActions, 0);
    assert.equal(idleJonas.lastActiveAt, null);

    // Completing a task is the highest-weighted action; the leaderboard must pick it up.
    const [section] = data(await daniel.get(`/projects/${PROJECTS.portal}/sections`));
    const task = data(await daniel.post(`/projects/${PROJECTS.portal}/tasks`, { sectionUuid: section.uuid, title: "Productivity probe" }));
    assert.equal((await daniel.patch(`/tasks/${task.uuid}`, { status: "done" })).status, 200);

    const recent = data(await maya.get("/admin/productivity?period=7d"));
    assert.equal(typeof recent.since, "string");
    assert.ok(recent.totals.actions <= before.totals.actions + 2, "a shorter window never counts more than all time");

    const after = data(await maya.get("/admin/productivity?period=all"));
    const danielBefore = before.entries.find((e: any) => e.user.uuid === USERS.daniel.uuid);
    const danielAfter = after.entries.find((e: any) => e.user.uuid === USERS.daniel.uuid);
    assert.equal(danielAfter.counts.tasksCreated, danielBefore.counts.tasksCreated + 1);
    assert.equal(danielAfter.counts.tasksCompleted, danielBefore.counts.tasksCompleted + 1);
    assert.equal(danielAfter.score, danielBefore.score + PRODUCTIVITY_WEIGHTS.tasksCreated + PRODUCTIVITY_WEIGHTS.tasksCompleted);
    assert.ok(danielAfter.activeDays >= 1 && danielAfter.projects >= 1);
    assert.equal(typeof danielAfter.lastActiveAt, "string");
    assert.deepEqual(after.weights, PRODUCTIVITY_WEIGHTS, "default weights are reported with the ranking");
  });

  it("scores with the deployment's configured weights", async () => {
    const weights = { ...PRODUCTIVITY_WEIGHTS, tasksCompleted: 50, comments: 0 };
    const tuned = await startTestServer({ productivity: { weights } });
    try {
      const admin = await tuned.client("maya");
      const report = data(await admin.get("/admin/productivity?period=all"));
      assert.deepEqual(report.weights, weights);
      for (const entry of report.entries) {
        assert.equal(entry.score, productivityScore(entry.counts, weights));
      }
      const commenter = report.entries.find((e: any) => e.counts.comments > 0);
      assert.ok(commenter, "seed has at least one commenter");
      assert.equal(commenter.score, productivityScore({ ...commenter.counts, comments: 0 }, weights), "comments no longer earn points");
      const scores = report.entries.map((e: any) => e.score);
      assert.deepEqual(scores, [...scores].sort((a, b) => b - a), "ranking follows the tuned scores");
    } finally {
      await tuned.close();
    }
  });
});
