import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SECTION_TITLE_MAX_LENGTH } from "@scope/contracts";
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

    await mockApi.logout();
    await mockApi.login({ email: "priya@infosoft.ph", password: "password" });
    const activity = await mockApi.listActivityPage({ project: LEGACY, type: "project", page: 1, perPage: 10 });
    assert.ok(activity.items.some((a) => a.action === "project.restored"));

    await mockApi.logout();
    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    await mockApi.deleteProject(LEGACY);
    assert.equal((await mockApi.adminListProjects({ status: "deleted" })).items[0]?.uuid, LEGACY, "soft delete keeps the project restorable");
  });

  it("holds self-registered accounts until an administrator approves them", async () => {
    await mockApi.logout();
    const registered = await mockApi.register({ name: "Waitlisted", email: "waitlisted@example.com", password: "longenough" });
    assert.equal(registered.pendingApproval, true);
    await expectApiError(mockApi.login({ email: "waitlisted@example.com", password: "longenough" }), 403, "account_pending");
    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    const pending = await mockApi.adminListUsers({ status: "pending" });
    assert.equal(pending.items[0]?.email, "waitlisted@example.com");
    assert.equal((await mockApi.adminStats()).users.pending, 1);
    await expectApiError(mockApi.adminSendPasswordReset(pending.items[0].uuid), 409);
    assert.ok((await mockApi.adminApproveUser(pending.items[0].uuid)).approvedAt);
    const approvedUser = await mockApi.login({ email: "waitlisted@example.com", password: "longenough" });
    assert.equal(approvedUser.email, "waitlisted@example.com");
  });

  it("lets an administrator set a password for a user and for themselves", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    await mockApi.adminSetUserPassword(JONAS, { password: "jonas-new-pass" });
    await mockApi.logout();
    await expectApiError(mockApi.login({ email: "jonas@infosoft.ph", password: "password" }), 401, "invalid_credentials");
    assert.equal((await mockApi.login({ email: "jonas@infosoft.ph", password: "jonas-new-pass" })).email, "jonas@infosoft.ph");
    await mockApi.logout();
    await mockApi.login({ email: "maya@infosoft.ph", password: "password" });
    await mockApi.adminSetUserPassword(MAYA, { password: "maya-new-pass" });
    await mockApi.logout();
    assert.equal((await mockApi.login({ email: "maya@infosoft.ph", password: "maya-new-pass" })).email, "maya@infosoft.ph");
    await mockApi.adminSetUserPassword(MAYA, { password: "password" });
    await mockApi.adminSetUserPassword(JONAS, { password: "password" });
  });

  it("enforces membership rules", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "priya@infosoft.ph", password: "password" });
    const [portal] = (await mockApi.listProjects()).filter((p) => p.name === "Barangay Records Portal");
    assert.ok(portal);
    // Priya is an editor on the portal: she cannot invite or read the activity log.
    await expectApiError(mockApi.inviteMember(portal.uuid, { email: "someone@example.com", role: "viewer" }), 403);
    await expectApiError(mockApi.listActivity(portal.uuid), 403);
    await expectApiError(mockApi.listActivityPage({ project: portal.uuid }), 403);
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
    assert.equal(seeded.find((s) => s.title === "UAT feedback — September")?.revisionDate, "2026-09-15");
    assert.equal(seeded.find((s) => s.title === "UAT feedback — October")?.completedAt, null);
    assert.equal(seeded.find((s) => s.title === "UAT feedback — October")?.revisionDate, "2026-10-20");

    const revision = await mockApi.createSection(treasury.uuid, { title: "Round 3", kind: "revision", revisionDate: "2026-11-01" });
    assert.equal(revision.revisionDate, "2026-11-01");
    assert.equal((await mockApi.updateSection(revision.uuid, { revisionDate: "2026-11-03" })).revisionDate, "2026-11-03");
    assert.equal(revision.completedAt, null, "empty sections are not complete");
    const fix = await mockApi.createTask(treasury.uuid, { sectionUuid: revision.uuid, title: "Fix" });
    await mockApi.updateTask(fix.uuid, { status: "done" });
    const stamped = (await mockApi.listSections(treasury.uuid)).find((s) => s.uuid === revision.uuid)!;
    assert.ok(stamped.completedAt, "stamped when the last task resolves");
    assert.ok((await mockApi.listActivity(treasury.uuid)).some((a) => a.action === "section.completed" && a.subject === "Round 3"));

    await mockApi.updateTask(fix.uuid, { status: "for_qa" });
    assert.equal((await mockApi.listSections(treasury.uuid)).find((s) => s.uuid === revision.uuid)!.completedAt, null, "cleared when a task reopens");
  });

  it("optionally groups scopes and revisions into phases and ungroups on delete", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    const [treasury] = (await mockApi.listProjects()).filter((p) => p.name === "Treasury Payment Gateway");
    const phases = await mockApi.listPhases(treasury.uuid);
    assert.ok(phases.some((p) => p.title === "Integrations"));
    assert.ok(phases.some((p) => p.title === "Acceptance"));

    const extra = await mockApi.createPhase(treasury.uuid, { title: "Wrap-up", color: "rose" });
    assert.equal(extra.color, "rose");
    assert.equal((await mockApi.updatePhase(extra.uuid, { color: "#4f46e5" })).color, "#4f46e5");
    const [ungrouped] = (await mockApi.listSections(treasury.uuid)).filter((s) => s.title === "Reconciliation");
    assert.equal(ungrouped.phaseUuid, null);
    const attached = await mockApi.updateSection(ungrouped.uuid, { phaseUuid: extra.uuid });
    assert.equal(attached.phaseUuid, extra.uuid);

    const [portal] = (await mockApi.listProjects()).filter((p) => p.name === "Barangay Records Portal");
    const [foreign] = await mockApi.listPhases(portal.uuid);
    await expectApiError(mockApi.updateSection(ungrouped.uuid, { phaseUuid: foreign.uuid }), 422);

    await mockApi.deletePhase(extra.uuid);
    assert.equal((await mockApi.listSections(treasury.uuid)).find((s) => s.uuid === ungrouped.uuid)?.phaseUuid, null);
    assert.ok(!(await mockApi.listPhases(treasury.uuid)).some((p) => p.uuid === extra.uuid));
  });

  it("can attach a note or link while creating a scope", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    const [portal] = (await mockApi.listProjects()).filter((p) => p.name === "Barangay Records Portal");
    const scope = await mockApi.createSection(portal.uuid, { title: "Kickoff", reference: { kind: "note", body: "  Bring the GIS dump.  " } });
    assert.equal(scope.references.length, 1);
    assert.equal(scope.references[0].kind, "note");
    assert.equal(scope.references[0].body, "Bring the GIS dump.");

    const revision = await mockApi.createSection(portal.uuid, {
      title: "Round 1",
      kind: "revision",
      reference: { kind: "link", body: "docs.example.com/rev", title: " Brief " },
    });
    assert.equal(revision.references[0].body, "https://docs.example.com/rev");
    assert.equal(revision.references[0].title, "Brief");
    const bad = await expectApiError(mockApi.createSection(portal.uuid, { title: "Bad link", reference: { kind: "link", body: "javascript:alert(1)" } }), 422);
    assert.equal(bad.fieldMap["reference.body"], "Enter a valid http or https link.");
  });

  it("adds notes and links to a scope after it exists", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    const [portal] = (await mockApi.listProjects()).filter((p) => p.name === "Barangay Records Portal");
    const migration = (await mockApi.listSections(portal.uuid)).find((s) => s.title === "Data migration")!;
    assert.ok(migration.references.some((r) => r.kind === "note"));
    assert.ok(migration.references.some((r) => r.kind === "link"));

    const note = await mockApi.addSectionReference(migration.uuid, { kind: "note", body: "  Extra hold.  " });
    assert.equal(note.body, "Extra hold.");
    assert.equal(note.title, null);
    const link = await mockApi.addSectionReference(migration.uuid, { kind: "link", body: "docs.example.com/uat", title: " UAT " });
    assert.equal(link.body, "https://docs.example.com/uat");
    assert.equal(link.title, "UAT");
    await expectApiError(mockApi.addSectionReference(migration.uuid, { kind: "link", body: "javascript:alert(1)" }), 422);

    const after = (await mockApi.listSections(portal.uuid)).find((s) => s.uuid === migration.uuid)!;
    assert.ok(after.references.some((r) => r.uuid === note.uuid));
    await mockApi.deleteSectionReference(migration.uuid, note.uuid);
    assert.ok(!(await mockApi.listSectionReferences(migration.uuid)).some((r) => r.uuid === note.uuid));

    await mockApi.logout();
    await mockApi.login({ email: "jonas@infosoft.ph", password: "password" });
    const visible = await mockApi.listSectionReferences(migration.uuid);
    assert.ok(visible.some((r) => r.uuid === link.uuid));
    await expectApiError(mockApi.addSectionReference(migration.uuid, { kind: "note", body: "Viewer note" }), 403);
  });

  it("rejects a scope title over the shared limit", async () => {
    await mockApi.logout();
    await mockApi.login({ email: "daniel@infosoft.ph", password: "password" });
    const [treasury] = (await mockApi.listProjects()).filter((p) => p.name === "Treasury Payment Gateway");
    const tooLong = await expectApiError(mockApi.createSection(treasury.uuid, { title: "x".repeat(SECTION_TITLE_MAX_LENGTH + 1) }), 422);
    assert.equal(tooLong.fieldMap.title, `Use at most ${SECTION_TITLE_MAX_LENGTH} characters.`);
    const created = await mockApi.createSection(treasury.uuid, { title: "x".repeat(SECTION_TITLE_MAX_LENGTH) });
    assert.equal(created.title.length, SECTION_TITLE_MAX_LENGTH);
  });
});
