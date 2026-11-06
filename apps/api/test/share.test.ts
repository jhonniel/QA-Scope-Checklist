import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { isGuestUser, PUBLIC_GUEST_USER_UUID } from "@scope/contracts";
import { data, errorCode, PROJECTS, startTestServer, UNKNOWN_UUID, type Client, type TestServer } from "./helpers.ts";

describe("public project share", () => {
  let server: TestServer;
  let daniel: Client;
  let jonas: Client;
  let guest: Client;
  let token: string;
  let migrationUuid: string;
  let lookupUuid: string;
  let openTaskUuid: string;
  let clientCheckedTaskUuid: string;

  before(async () => {
    server = await startTestServer();
    [daniel, jonas, guest] = await Promise.all([server.client("daniel"), server.client("jonas"), server.client()]);
  });
  after(() => server.close());

  it("hides sharing from viewers and from anyone without the token", async () => {
    assert.equal((await guest.get(`/share/${UNKNOWN_UUID}`)).status, 404);
    assert.equal((await jonas.get(`/projects/${PROJECTS.portal}/share`)).status, 403);
    assert.equal((await guest.get(`/projects/${PROJECTS.portal}/share`)).status, 401);
  });

  it("lets an editor publish selected scopes and share a public link", async () => {
    const sections = data(await daniel.get(`/projects/${PROJECTS.portal}/sections`));
    migrationUuid = sections.find((s: { title: string }) => s.title === "Data migration").uuid;
    lookupUuid = sections.find((s: { title: string }) => s.title === "Resident lookup").uuid;
    const tasks = data(await daniel.get(`/projects/${PROJECTS.portal}/tasks`)).filter((t: { sectionUuid: string }) => t.sectionUuid === migrationUuid);
    const open = tasks.find((t: { clientCheck: unknown }) => t.clientCheck === null);
    const ticked = tasks.find((t: { clientCheck: unknown }) => t.clientCheck !== null);
    assert.ok(open && ticked, "need one open Client box and one already ticked");
    openTaskUuid = open.uuid;
    clientCheckedTaskUuid = ticked.uuid;

    const updated = data(
      await daniel.patch(`/projects/${PROJECTS.portal}/share`, {
        enabled: true,
        publicSectionUuids: [migrationUuid],
      }),
    );
    assert.equal(updated.enabled, true);
    assert.equal(typeof updated.token, "string");
    assert.deepEqual(updated.publicSectionUuids, [migrationUuid]);
    token = updated.token;
  });

  it("shows guests only the chosen scopes and lets them tick Client", async () => {
    const snapshot = data(await guest.get(`/share/${token}`));
    assert.equal(snapshot.project.name, "Barangay Records Portal");
    assert.deepEqual(
      snapshot.sections.map((s: { title: string }) => s.title),
      ["Data migration"],
    );
    assert.ok(!snapshot.sections.some((s: { uuid: string }) => s.uuid === lookupUuid));
    assert.ok(snapshot.tasks.every((t: { sectionUuid: string }) => t.sectionUuid === migrationUuid));
    assert.ok(snapshot.tasks.every((t: { assignee: { email: string } | null }) => !t.assignee || t.assignee.email === ""));

    const checked = data(await guest.patch(`/share/${token}/tasks/${openTaskUuid}`, { clientChecked: true, guestName: "  Ana Cruz  " }));
    assert.equal(checked.clientCheck.checkedBy.name, "Ana Cruz");
    assert.equal(checked.clientCheck.checkedBy.uuid, PUBLIC_GUEST_USER_UUID);
    assert.equal(checked.clientCheck.checkedBy.email, "");
    assert.equal(isGuestUser(checked.clientCheck.checkedBy), true);

    const comments = data(await guest.get(`/share/${token}/tasks/${openTaskUuid}/comments`));
    assert.ok(Array.isArray(comments));
  });

  it("rejects developer ticks, nameless ticks, and clearing a member Client check", async () => {
    assert.equal((await guest.patch(`/share/${token}/tasks/${openTaskUuid}`, { developerChecked: true })).status, 422);
    data(await guest.patch(`/share/${token}/tasks/${openTaskUuid}`, { clientChecked: false, guestName: "Ana Cruz" }));
    assert.equal(errorCode(await guest.patch(`/share/${token}/tasks/${openTaskUuid}`, { clientChecked: true, guestName: "A" })), "validation_failed");
    const forbidden = await guest.patch(`/share/${token}/tasks/${clientCheckedTaskUuid}`, { clientChecked: false, guestName: "Ana Cruz" });
    assert.equal(forbidden.status, 403);
    assert.equal((await guest.get(`/share/${token}/tasks/${UNKNOWN_UUID}/comments`)).status, 404);
  });

  it("stops the old URL after the link is reset", async () => {
    const rotated = data(await daniel.patch(`/projects/${PROJECTS.portal}/share`, { rotateToken: true }));
    assert.notEqual(rotated.token, token);
    assert.equal((await guest.get(`/share/${token}`)).status, 404);
    const next = data(await guest.get(`/share/${rotated.token}`));
    assert.equal(next.project.name, "Barangay Records Portal");
  });
});
