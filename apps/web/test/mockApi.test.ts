import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ApiError } from "@/services/api/ApiError";
import { mockApi } from "@/services/mock/mockApi";

/**
 * The in-memory API must enforce the same rules as the server so the UI
 * behaves identically in mock mode. These tests pin the rules the UI relies on.
 */
const MAYA = "a1a10000-0000-4000-8000-000000000001";
const JONAS = "a1a10000-0000-4000-8000-000000000004";
const LEGACY = "c3c30000-0000-4000-8000-000000000005";

async function expectApiError(promise: Promise<unknown>, status: number, code?: string): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(ApiError.is(error), `expected ApiError, got ${String(error)}`);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected a ${status} error`);
}

describe("mock API", () => {
  before(async () => {
    await mockApi.logout();
  });

  it("requires a session and validates credentials", async () => {
    await expectApiError(mockApi.listMyInvitations(), 401, "unauthenticated");
    await expectApiError(mockApi.login({ email: "daniel@infosoft.ph", password: "wrong" }), 401, "invalid_credentials");
    const user = await mockApi.login({ email: "Daniel@infosoft.ph", password: "password" });
    assert.equal(user.name, "Daniel Reyes");
    assert.equal((await mockApi.getCurrentUser())?.uuid, user.uuid);
  });

  it("keeps administration closed to regular users", async () => {
    await expectApiError(mockApi.adminStats(), 403, "forbidden");
    await expectApiError(mockApi.adminListUsers({}), 403, "forbidden");
    await expectApiError(mockApi.adminRestoreProject(LEGACY), 403, "forbidden");
  });

  it("applies the admin account rules", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    const stats = await mockApi.adminStats();
    assert.equal(stats.users.total, 4);
    assert.equal(stats.projects.deleted, 1);

    await expectApiError(mockApi.adminUpdateUser(MAYA, { role: "user" }), 409, "conflict");
    await expectApiError(mockApi.adminSetUserDisabled(MAYA, true), 409, "conflict");

    const disabled = await mockApi.adminSetUserDisabled(JONAS, true);
    assert.ok(disabled.disabledAt);
    const list = await mockApi.adminListUsers({ status: "disabled" });
    assert.deepEqual(
      list.items.map((u) => u.uuid),
      [JONAS],
    );
    const audit = await mockApi.adminListAudit({ page: 1, perPage: 5 });
    assert.equal(audit.items[0].action, "user.disabled");

    await mockApi.logout();
    await expectApiError(mockApi.login({ email: "jonas@infosoft.ph", password: "password" }), 403, "account_disabled");

    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    assert.equal((await mockApi.adminSetUserDisabled(JONAS, false)).disabledAt, null);
  });

  it("moves deleted projects to the bin and restores them", async () => {
    const before = await mockApi.listProjects();
    assert.ok(!before.some((p) => p.uuid === LEGACY));
    const bin = await mockApi.adminListProjects({ status: "deleted" });
    assert.equal(bin.items[0]?.uuid, LEGACY);

    const restored = await mockApi.adminRestoreProject(LEGACY);
    assert.equal(restored.deletedAt, null);
    assert.ok((await mockApi.listProjects()).some((p) => p.uuid === LEGACY));
    await expectApiError(mockApi.adminRestoreProject(LEGACY), 409);
    assert.equal((await mockApi.adminListProjects({ status: "deleted" })).total, 0);

    await mockApi.deleteProject(LEGACY);
    assert.equal((await mockApi.adminListProjects({ status: "deleted" })).items[0]?.uuid, LEGACY, "soft delete keeps the project restorable");
    const activity = await mockApi.listActivityPage({ project: LEGACY, type: "project", page: 1, perPage: 10 });
    assert.ok(activity.items.some((a) => a.action === "project.restored"));
  });

  it("enforces membership rules", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "priya@infosoft.ph", password: "password" });
    const [portal] = (await mockApi.listProjects()).filter((p) => p.name === "Barangay Records Portal");
    assert.ok(portal);
    // Priya is an editor on the portal: she cannot invite.
    await expectApiError(mockApi.inviteMember(portal.uuid, { email: "someone@example.com", role: "viewer" }), 403);
    // Owners cannot leave.
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    await expectApiError(mockApi.leaveProject(portal.uuid), 409);
    const dup = await expectApiError(mockApi.inviteMember(portal.uuid, { email: "priya@infosoft.ph", role: "viewer" }), 422);
    assert.deepEqual(dup.fieldMap, { email: dup.fields[0].message });
  });

  it("stamps a section when its last task resolves and clears it when work reopens, like the server", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    const [treasury] = (await mockApi.listProjects()).filter((p) => p.name === "Treasury Payment Gateway");
    const seeded = await mockApi.listSections(treasury.uuid);
    assert.ok(seeded.find((s) => s.title === "UAT feedback — September")?.completedAt, "the finished seeded revision carries its date");
    assert.equal(seeded.find((s) => s.title === "UAT feedback — October")?.completedAt, null);

    const revision = await mockApi.createSection(treasury.uuid, { title: "Round 3", kind: "revision" });
    assert.equal(revision.completedAt, null, "empty sections are not complete");
    const fix = await mockApi.createTask(treasury.uuid, { sectionUuid: revision.uuid, title: "Fix" });
    await mockApi.updateTask(fix.uuid, { status: "done" });
    const stamped = (await mockApi.listSections(treasury.uuid)).find((s) => s.uuid === revision.uuid)!;
    assert.ok(stamped.completedAt, "stamped when the last task resolves");
    assert.ok((await mockApi.listActivity(treasury.uuid)).some((a) => a.action === "section.completed" && a.subject === "Round 3"));

    await mockApi.updateTask(fix.uuid, { status: "for_qa" });
    assert.equal((await mockApi.listSections(treasury.uuid)).find((s) => s.uuid === revision.uuid)!.completedAt, null, "cleared when a task reopens");
  });
});
