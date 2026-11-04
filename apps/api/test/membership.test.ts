import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CapturingMailService, data, errorCode, errorFields, ORIGIN, PROJECTS, startTestServer, UNKNOWN_UUID, USERS, type Client, type TestServer } from "./helpers.ts";

describe("membership and invitations", () => {
  let server: TestServer;
  let daniel: Client;
  let priya: Client;
  let jonas: Client;

  before(async () => {
    server = await startTestServer();
    [daniel, priya, jonas] = await Promise.all([server.client("daniel"), server.client("priya"), server.client("jonas")]);
  });
  after(() => server.close());

  it("lists pending invitations for the signed-in e-mail and lets the invitee accept", async () => {
    const mine = data(await jonas.get("/invitations"));
    const treasury = mine.find((i: any) => i.projectUuid === PROJECTS.treasury);
    assert.ok(treasury, "Jonas was invited to Treasury by the seed");
    assert.equal(treasury.projectName, "Treasury Payment Gateway");
    assert.equal(treasury.role, "editor");

    assert.equal((await jonas.get(`/projects/${PROJECTS.treasury}`)).status, 404, "not visible before accepting");
    const accepted = await jonas.post(`/invitations/${treasury.uuid}/accept`);
    assert.equal(accepted.status, 200);
    const project = data(accepted);
    assert.equal(project.uuid, PROJECTS.treasury);
    assert.equal(project.members.find((m: any) => m.user.uuid === USERS.jonas.uuid)?.role, "editor");
    assert.equal((await jonas.post(`/invitations/${treasury.uuid}/accept`)).status, 409, "cannot accept twice");

    // Editor now: may add a section.
    assert.equal((await jonas.post(`/projects/${PROJECTS.treasury}/sections`, { title: "From Jonas" })).status, 201);
  });

  it("invites by e-mail, sends the link, and blocks duplicates", async () => {
    const r = await daniel.post(`/projects/${PROJECTS.treasury}/invitations`, { email: "Guest.User@Example.com", role: "viewer" });
    assert.equal(r.status, 201);
    const invitation = data(r);
    assert.equal(invitation.email, "guest.user@example.com");
    assert.equal(invitation.status, "pending");
    assert.ok(!("tokenHash" in invitation) && !("token" in invitation), "tokens never appear in the API");
    const link = CapturingMailService.link(server.mail.lastTo("guest.user@example.com"));
    assert.ok(link?.startsWith(`${ORIGIN}/invitations/`), `invitation link: ${link}`);

    const dup = await daniel.post(`/projects/${PROJECTS.treasury}/invitations`, { email: "guest.user@example.com", role: "editor" });
    assert.equal(dup.status, 422);
    assert.deepEqual(errorFields(dup), ["email"]);
    const member = await daniel.post(`/projects/${PROJECTS.treasury}/invitations`, { email: USERS.priya.email, role: "viewer" });
    assert.equal(member.status, 422, "existing members cannot be invited");
    assert.equal((await daniel.post(`/projects/${PROJECTS.treasury}/invitations`, { email: "x@example.com", role: "owner" })).status, 422);
    assert.equal((await priya.post(`/projects/${PROJECTS.treasury}/invitations`, { email: "y@example.com", role: "viewer" })).status, 403, "editors cannot invite");
    assert.equal((await priya.get(`/projects/${PROJECTS.treasury}/invitations`)).status, 403);

    const list = data(await daniel.get(`/projects/${PROJECTS.treasury}/invitations`));
    assert.ok(list.some((i: any) => i.uuid === invitation.uuid));
  });

  it("redeems the e-mailed token only for the invited address and only once", async () => {
    const link = CapturingMailService.link(server.mail.lastTo("guest.user@example.com"))!;
    const token = decodeURIComponent(link.split("/invitations/")[1]);

    const wrongPerson = await jonas.post("/invitations/accept-token", { token });
    assert.equal(wrongPerson.status, 403);
    assert.match((wrongPerson.body as any).error.message, /guest\.user@example\.com/);

    const guest = await server.client();
    const registered = await guest.post("/auth/register", { name: "Guest User", email: "guest.user@example.com", password: "guest-password" });
    assert.equal(registered.status, 201);
    assert.equal(data(registered).pendingApproval, true);
    assert.equal((await guest.post("/invitations/accept-token", { token })).status, 401, "cannot accept while waiting for approval");

    const maya = await server.client("maya");
    const pending = data(await maya.get("/admin/users?status=pending"));
    const created = pending.find((u: { email: string }) => u.email === "guest.user@example.com");
    assert.ok(created);
    assert.equal((await maya.post(`/admin/users/${created.uuid}/approve`)).status, 200);
    assert.equal((await guest.login("guest.user@example.com", "guest-password")).status, 200);
    const accepted = await guest.post("/invitations/accept-token", { token });
    assert.equal(accepted.status, 200);
    assert.equal(data(accepted).uuid, PROJECTS.treasury);

    const reuse = await guest.post("/invitations/accept-token", { token });
    assert.equal(reuse.status, 400);
    assert.equal(errorCode(reuse), "invalid_token");
    assert.equal(errorCode(await guest.post("/invitations/accept-token", { token: "definitely-not-a-real-token" })), "invalid_token");
  });

  it("revokes pending invitations and refuses once answered", async () => {
    const created = data(await daniel.post(`/projects/${PROJECTS.treasury}/invitations`, { email: "revoke.me@example.com", role: "viewer" }));
    assert.equal((await priya.delete(`/projects/${PROJECTS.treasury}/invitations/${created.uuid}`)).status, 403);
    assert.equal((await daniel.delete(`/projects/${PROJECTS.treasury}/invitations/${created.uuid}`)).status, 200);
    assert.equal((await daniel.delete(`/projects/${PROJECTS.treasury}/invitations/${created.uuid}`)).status, 409);
    assert.equal((await daniel.delete(`/projects/${PROJECTS.portal}/invitations/${created.uuid}`)).status, 404, "wrong project");
    const list = data(await daniel.get(`/projects/${PROJECTS.treasury}/invitations`));
    assert.equal(list.find((i: any) => i.uuid === created.uuid)?.status, "revoked", "history is kept");
  });

  it("declines an invitation", async () => {
    data(await daniel.post(`/projects/${PROJECTS.permits}/invitations`, { email: USERS.jonas.email, role: "viewer" }));
    const mine = data(await jonas.get("/invitations"));
    const inv = mine.find((i: any) => i.projectUuid === PROJECTS.permits);
    assert.ok(inv);
    assert.equal((await jonas.post(`/invitations/${inv.uuid}/decline`)).status, 200);
    assert.equal((await jonas.post(`/invitations/${inv.uuid}/accept`)).status, 409);
    assert.equal((await jonas.get(`/projects/${PROJECTS.permits}`)).status, 404);
  });

  it("changes roles, removes members and protects the owner row", async () => {
    const project = data(await daniel.get(`/projects/${PROJECTS.portal}`));
    const jonasRow = project.members.find((m: any) => m.user.uuid === USERS.jonas.uuid);
    const ownerRow = project.members.find((m: any) => m.role === "owner");

    assert.equal((await priya.patch(`/projects/${PROJECTS.portal}/members/${jonasRow.uuid}`, { role: "editor" })).status, 403, "editors cannot manage members");
    assert.equal((await daniel.patch(`/projects/${PROJECTS.portal}/members/${ownerRow.uuid}`, { role: "editor" })).status, 409);
    assert.equal((await daniel.patch(`/projects/${PROJECTS.portal}/members/${jonasRow.uuid}`, { role: "owner" })).status, 422);

    const promoted = data(await daniel.patch(`/projects/${PROJECTS.portal}/members/${jonasRow.uuid}`, { role: "editor" }));
    assert.equal(promoted.members.find((m: any) => m.uuid === jonasRow.uuid).role, "editor");
    assert.equal((await jonas.post(`/projects/${PROJECTS.portal}/sections`, { title: "Now allowed" })).status, 201);

    const activity = data(await daniel.get(`/activity?project=${PROJECTS.portal}&type=members&page=1&perPage=5`));
    const change = activity.find((a: any) => a.action === "member.role_changed");
    assert.deepEqual(change?.meta, { from: "viewer", to: "editor" });

    assert.equal((await daniel.delete(`/projects/${PROJECTS.portal}/members/${ownerRow.uuid}`)).status, 409, "owner cannot be removed");
    assert.equal((await daniel.delete(`/projects/${PROJECTS.portal}/members/${jonasRow.uuid}`)).status, 200);
    assert.equal((await jonas.get(`/projects/${PROJECTS.portal}`)).status, 404, "removed member loses access");
    assert.equal((await daniel.delete(`/projects/${PROJECTS.portal}/members/${UNKNOWN_UUID}`)).status, 404);
  });

  it("lets editors leave but not owners", async () => {
    assert.equal((await daniel.post(`/projects/${PROJECTS.portal}/members/leave`)).status, 409, "owners must transfer first");
    assert.equal((await priya.post(`/projects/${PROJECTS.portal}/members/leave`)).status, 200);
    assert.equal((await priya.get(`/projects/${PROJECTS.portal}`)).status, 404);
  });

  it("transfers ownership: previous owner becomes editor", async () => {
    const project = data(await priya.get(`/projects/${PROJECTS.hr}`));
    const danielRow = project.members.find((m: any) => m.user.uuid === USERS.daniel.uuid);
    const priyaRow = project.members.find((m: any) => m.user.uuid === USERS.priya.uuid);

    assert.equal((await daniel.post(`/projects/${PROJECTS.hr}/members/transfer`, { memberUuid: danielRow.uuid })).status, 403, "editors cannot transfer");
    assert.equal((await priya.post(`/projects/${PROJECTS.hr}/members/transfer`, { memberUuid: priyaRow.uuid })).status, 409, "already the owner");

    const transferred = data(await priya.post(`/projects/${PROJECTS.hr}/members/transfer`, { memberUuid: danielRow.uuid }));
    assert.equal(transferred.owner.uuid, USERS.daniel.uuid);
    assert.equal(transferred.members.find((m: any) => m.user.uuid === USERS.daniel.uuid).role, "owner");
    assert.equal(transferred.members.find((m: any) => m.user.uuid === USERS.priya.uuid).role, "editor");

    assert.equal((await priya.patch(`/projects/${PROJECTS.hr}`, { status: "archived" })).status, 403, "previous owner can no longer change status");
    assert.equal((await daniel.patch(`/projects/${PROJECTS.hr}`, { status: "archived" })).status, 200);
    const activity = data(await daniel.get(`/activity?project=${PROJECTS.hr}&type=members&page=1&perPage=5`));
    assert.ok(activity.some((a: any) => a.action === "project.ownership_transferred"));
  });
});
