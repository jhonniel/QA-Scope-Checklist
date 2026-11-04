import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { data, errorCode, errorFields, PROJECTS, startTestServer, UNKNOWN_UUID, USERS, type Client, type TestServer } from "./helpers.ts";

describe("projects and checklists", () => {
  let server: TestServer;
  let daniel: Client;
  let priya: Client;
  let jonas: Client;
  let maya: Client;

  before(async () => {
    server = await startTestServer();
    [daniel, priya, jonas, maya] = await Promise.all([server.client("daniel"), server.client("priya"), server.client("jonas"), server.client("maya")]);
  });
  after(() => server.close());

  it("lists only the projects a user belongs to; admins see everything live", async () => {
    const mine = data(await jonas.get("/projects"));
    assert.deepEqual(
      mine.map((p: any) => p.uuid),
      [PROJECTS.portal],
    );
    const all = data(await maya.get("/projects"));
    assert.equal(all.length, 4, "admin sees every live project");
    assert.ok(!all.some((p: any) => p.uuid === PROJECTS.legacy), "soft-deleted projects are hidden everywhere");
    for (const p of all) {
      assert.ok(!("id" in p) && !("ownerId" in p), "no internal ids");
      assert.equal(typeof p.stats.completionPercent, "number");
      assert.ok(Array.isArray(p.members));
    }
  });

  it("hides invisible projects as 404 (never 403)", async () => {
    const r = await jonas.get(`/projects/${PROJECTS.hr}`);
    assert.equal(r.status, 404);
    assert.equal((await jonas.get(`/projects/${PROJECTS.hr}/tasks`)).status, 404);
    assert.equal((await daniel.get(`/projects/${UNKNOWN_UUID}`)).status, 404);
    assert.equal((await daniel.get("/projects/not-a-uuid")).status, 422);
  });

  it("creates a project with the owner as member and a default General section", async () => {
    const r = await daniel.post("/projects", { name: "Brand New", description: "Testing", startDate: "2026-01-01", deadline: "2026-03-01" });
    assert.equal(r.status, 201);
    const project = data(r);
    assert.equal(project.owner.uuid, USERS.daniel.uuid);
    assert.equal(project.status, "active");
    assert.equal(project.members.length, 1);
    assert.equal(project.members[0].role, "owner");
    assert.equal(project.stats.sectionCount, 1);
    const sections = data(await daniel.get(`/projects/${project.uuid}/sections`));
    assert.equal(sections[0].title, "General");

    assert.equal((await daniel.post("/projects", { name: "x" })).status, 422);
  });

  it("updates details; only the owner changes status; deadline cannot precede start", async () => {
    const r = await daniel.patch(`/projects/${PROJECTS.portal}`, { description: "Updated scope" });
    assert.equal(r.status, 200);
    assert.equal(data(r).description, "Updated scope");

    const bad = await daniel.patch(`/projects/${PROJECTS.portal}`, { startDate: "2026-05-01", deadline: "2026-04-01" });
    assert.equal(bad.status, 422);
    assert.deepEqual(errorFields(bad), ["deadline"]);

    assert.equal((await daniel.patch(`/projects/${PROJECTS.portal}`, {})).status, 422);
    assert.equal((await daniel.patch(`/projects/${PROJECTS.portal}`, { nope: 1 })).status, 422);

    // Priya is an editor on the portal: details yes, status no.
    assert.equal((await priya.patch(`/projects/${PROJECTS.portal}`, { description: "Editor edit" })).status, 200);
    assert.equal((await priya.patch(`/projects/${PROJECTS.portal}`, { status: "archived" })).status, 403);
    // Jonas is a viewer: nothing.
    assert.equal((await jonas.patch(`/projects/${PROJECTS.portal}`, { description: "Viewer edit" })).status, 403);

    const archived = await daniel.patch(`/projects/${PROJECTS.portal}`, { status: "archived" });
    assert.equal(data(archived).status, "archived");
    const activity = data(await daniel.get(`/activity?project=${PROJECTS.portal}&limit=5`));
    const change = activity.find((a: any) => a.action === "project.status_changed");
    assert.ok(change, "status change is logged");
    assert.deepEqual(change.meta, { from: "active", to: "archived" });
    await daniel.patch(`/projects/${PROJECTS.portal}`, { status: "active" });
  });

  it("manages sections: create, rename, reorder, refuse deleting the last one", async () => {
    const created = data(await daniel.post("/projects", { name: "Sections Lab" }));
    const [general] = data(await daniel.get(`/projects/${created.uuid}/sections`));

    const lastDelete = await daniel.delete(`/sections/${general.uuid}`);
    assert.equal(lastDelete.status, 409, "the last section cannot be deleted");

    const second = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "Second", description: "Extra" }));
    assert.equal(second.position, 1);
    assert.equal(second.kind, "scope", "sections are part of the scope unless said otherwise");
    assert.equal(general.kind, "scope");

    const renamed = data(await daniel.patch(`/sections/${second.uuid}`, { title: "Renamed", description: null }));
    assert.equal(renamed.title, "Renamed");
    assert.equal(renamed.description, null);

    const revision = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "Client feedback", kind: "revision", revisionDate: "2026-08-01" }));
    assert.equal(revision.kind, "revision");
    assert.equal(revision.revisionDate, "2026-08-01");
    assert.equal(data(await daniel.patch(`/sections/${revision.uuid}`, { revisionDate: "2026-08-15" })).revisionDate, "2026-08-15");
    assert.equal(data(await daniel.patch(`/sections/${revision.uuid}`, { revisionDate: null })).revisionDate, null);
    assert.equal(data(await daniel.patch(`/sections/${revision.uuid}`, { kind: "scope" })).kind, "scope", "the kind can be corrected later");
    assert.equal((await daniel.post(`/projects/${created.uuid}/sections`, { title: "x", kind: "hotfix" })).status, 422);
    const activity = data(await daniel.get(`/activity?project=${created.uuid}&type=project&page=1&perPage=10`));
    assert.ok(
      activity.some((a: any) => a.action === "section.created" && a.subject === "Client feedback" && a.meta?.kind === "revision"),
      "creating a revision is recorded as such",
    );
    assert.equal((await daniel.delete(`/sections/${revision.uuid}`)).status, 200);

    const reordered = data(await daniel.post(`/projects/${created.uuid}/sections/reorder`, { orderedSectionUuids: [second.uuid, general.uuid, UNKNOWN_UUID] }));
    assert.deepEqual(
      reordered.map((s: any) => s.uuid),
      [second.uuid, general.uuid],
      "foreign uuids are ignored and positions renumbered",
    );

    const task = data(await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: second.uuid, title: "Inside second" }));
    assert.equal((await daniel.delete(`/sections/${second.uuid}`)).status, 200);
    const tasks = data(await daniel.get(`/projects/${created.uuid}/tasks`));
    assert.ok(!tasks.some((t: any) => t.uuid === task.uuid), "tasks of a deleted section disappear");
  });

  it("accepts a 500-character scope title and rejects anything longer", async () => {
    const created = data(await daniel.post("/projects", { name: "Long Title Lab" }));
    const title = "x".repeat(500);
    const section = data(await daniel.post(`/projects/${created.uuid}/sections`, { title }));
    assert.equal(section.title.length, 500);
    const tooLong = await daniel.post(`/projects/${created.uuid}/sections`, { title: `${title}y` });
    assert.equal(tooLong.status, 422);
    assert.deepEqual(errorFields(tooLong), ["title"]);
    assert.equal(tooLong.body && !tooLong.body.success ? tooLong.body.error.fields?.[0]?.message : null, "Use at most 500 characters.");
  });

  it("stamps a section with the date it reached 100% and clears it when work reopens", async () => {
    const created = data(await daniel.post("/projects", { name: "Completion Lab" }));
    const [general] = data(await daniel.get(`/projects/${created.uuid}/sections`));
    assert.equal(general.completedAt, null, "an empty section is not complete");

    const revision = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "Round 1", kind: "revision" }));
    const a = data(await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: revision.uuid, title: "Fix A" }));
    const b = data(await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: revision.uuid, title: "Fix B" }));
    const sectionNow = async (uuid: string) => data(await daniel.get(`/projects/${created.uuid}/sections`)).find((s: any) => s.uuid === uuid);

    await daniel.patch(`/tasks/${a.uuid}`, { status: "done" });
    assert.equal((await sectionNow(revision.uuid)).completedAt, null, "one open task keeps it open");

    const before = Date.now() - 2000;
    await daniel.patch(`/tasks/${b.uuid}`, { status: "not_applicable" });
    const completedAt = (await sectionNow(revision.uuid)).completedAt;
    assert.ok(completedAt && Date.parse(completedAt) >= before && Date.parse(completedAt) <= Date.now() + 2000, "stamped with the current time when the last task resolves");
    const activity = data(await daniel.get(`/activity?project=${created.uuid}&type=project&page=1&perPage=10`));
    assert.ok(activity.some((e: any) => e.action === "section.completed" && e.subject === "Round 1" && e.meta?.kind === "revision"), "completion is recorded in the activity log");

    await daniel.patch(`/tasks/${b.uuid}`, { title: "Fix B (renamed)" });
    assert.equal((await sectionNow(revision.uuid)).completedAt, completedAt, "edits that do not touch completion keep the original date");

    const c = data(await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: revision.uuid, title: "Fix C" }));
    assert.equal((await sectionNow(revision.uuid)).completedAt, null, "a new open task reopens the section");
    await daniel.patch(`/tasks/${c.uuid}`, { status: "done" });
    assert.ok((await sectionNow(revision.uuid)).completedAt, "complete again");

    await daniel.patch(`/tasks/${c.uuid}`, { sectionUuid: general.uuid });
    assert.ok((await sectionNow(revision.uuid)).completedAt, "moving a resolved task out keeps the revision complete");
    assert.ok((await sectionNow(general.uuid)).completedAt, "and completes the section it moved into");
    await daniel.patch(`/tasks/${c.uuid}`, { status: "in_development" });
    assert.equal((await sectionNow(general.uuid)).completedAt, null, "reopening a task clears the stamp");

    assert.equal((await daniel.delete(`/tasks/${c.uuid}`)).status, 200);
    assert.equal((await sectionNow(general.uuid)).completedAt, null, "an emptied section is not complete");
  });

  it("creates, ticks, moves and deletes tasks with the acting user stamped server-side", async () => {
    const sections = data(await daniel.get(`/projects/${PROJECTS.portal}/sections`));
    const target = sections[0];

    const created = await daniel.post(`/projects/${PROJECTS.portal}/tasks`, { sectionUuid: target.uuid, title: "  New acceptance item  ", priority: "high", dueDate: "2026-12-31" });
    assert.equal(created.status, 201);
    const task = data(created);
    assert.equal(task.title, "New acceptance item");
    assert.equal(task.status, "not_started");
    assert.equal(task.developerCheck, null);

    const ticked = data(await daniel.patch(`/tasks/${task.uuid}`, { developerChecked: true }));
    assert.equal(ticked.developerCheck.checkedBy.uuid, USERS.daniel.uuid);
    assert.ok(ticked.developerCheck.checkedAt, "timestamp is stamped by the server");

    const clientTick = data(await maya.patch(`/tasks/${task.uuid}`, { clientChecked: true }));
    assert.equal(clientTick.clientCheck.checkedBy.uuid, USERS.maya.uuid);

    const unticked = data(await daniel.patch(`/tasks/${task.uuid}`, { developerChecked: false }));
    assert.equal(unticked.developerCheck, null);

    const statused = data(await daniel.patch(`/tasks/${task.uuid}`, { status: "for_qa" }));
    assert.equal(statused.status, "for_qa");
    assert.equal((await daniel.patch(`/tasks/${task.uuid}`, { status: "bogus" })).status, 422);
    assert.equal((await daniel.patch(`/tasks/${task.uuid}`, { developerCheckedAt: "2020-01-01" })).status, 422, "clients cannot supply timestamps");

    const moved = data(await daniel.patch(`/tasks/${task.uuid}`, { sectionUuid: sections[1].uuid }));
    assert.equal(moved.sectionUuid, sections[1].uuid);

    const activity = data(await daniel.get(`/activity?project=${PROJECTS.portal}&type=checks&page=1&perPage=10`));
    assert.ok(activity.some((a: any) => a.action === "task.checked"), "ticks are in the activity log");

    assert.equal((await daniel.delete(`/tasks/${task.uuid}`)).status, 200);
    assert.equal((await daniel.patch(`/tasks/${task.uuid}`, { title: "ghost" })).status, 404);
  });

  it("keeps viewers read-only except for comments", async () => {
    const tasks = data(await jonas.get(`/projects/${PROJECTS.portal}/tasks`));
    const task = tasks[0];
    assert.equal((await jonas.patch(`/tasks/${task.uuid}`, { developerChecked: true })).status, 403);
    assert.equal((await jonas.post(`/projects/${PROJECTS.portal}/tasks`, { sectionUuid: task.sectionUuid, title: "nope" })).status, 403);
    assert.equal((await jonas.post(`/projects/${PROJECTS.portal}/sections`, { title: "nope" })).status, 403);
    assert.equal((await jonas.delete(`/projects/${PROJECTS.portal}`)).status, 403);

    const comment = await jonas.post(`/tasks/${task.uuid}/comments`, { body: "Looks good from here." });
    assert.equal(comment.status, 201);
    assert.equal(data(comment).author.uuid, USERS.jonas.uuid);
    const comments = data(await jonas.get(`/tasks/${task.uuid}/comments`));
    assert.ok(comments.some((c: any) => c.body === "Looks good from here."));
    assert.equal((await jonas.post(`/tasks/${task.uuid}/comments`, { body: "   " })).status, 422);
  });

  it("reorders tasks within a section", async () => {
    const sections = data(await daniel.get(`/projects/${PROJECTS.hr}/sections`));
    const tasks = data(await priya.get(`/projects/${PROJECTS.hr}/tasks`));
    const inFirst = tasks.filter((t: any) => t.sectionUuid === sections[0].uuid);
    assert.ok(inFirst.length >= 2);
    const reversed = [...inFirst].reverse().map((t: any) => t.uuid);
    const r = data(await priya.post(`/projects/${PROJECTS.hr}/tasks/reorder`, { sectionUuid: sections[0].uuid, orderedTaskUuids: reversed }));
    const after = r.filter((t: any) => t.sectionUuid === sections[0].uuid).sort((a: any, b: any) => a.position - b.position).map((t: any) => t.uuid);
    assert.deepEqual(after, reversed);
  });

  it("soft-deletes a project for the owner only and hides it afterwards", async () => {
    const created = data(await priya.post("/projects", { name: "Throwaway" }));
    assert.equal((await daniel.delete(`/projects/${created.uuid}`)).status, 404, "non-members cannot even see it");
    assert.equal((await priya.delete(`/projects/${created.uuid}`)).status, 200);
    assert.equal((await priya.get(`/projects/${created.uuid}`)).status, 404);
    assert.ok(!data(await maya.get("/projects")).some((p: any) => p.uuid === created.uuid));
  });

  it("pages the activity history and keeps the legacy contract", async () => {
    const legacy = await daniel.get(`/activity?project=${PROJECTS.portal}&limit=3`);
    assert.equal(legacy.status, 200);
    assert.ok(Array.isArray(data(legacy)) && data(legacy).length <= 3);
    assert.equal(legacy.body && "meta" in legacy.body, false);

    const paged = await daniel.get(`/activity?page=1&perPage=5&type=members`);
    assert.equal(paged.status, 200);
    const meta = (paged.body as any).meta;
    assert.equal(meta.page, 1);
    assert.equal(meta.perPage, 5);
    assert.ok(meta.total >= 1 && meta.totalPages >= 1);
    for (const entry of data(paged)) assert.match(entry.action, /^member\./);

    assert.equal((await daniel.get("/activity?type=bogus")).status, 422);
    assert.equal((await daniel.get("/activity?page=0")).status, 422);
    assert.equal((await jonas.get(`/activity?project=${PROJECTS.hr}&page=1`)).status, 404, "non-members cannot page a project's history");
    assert.equal(errorCode(await jonas.get(`/activity?project=${PROJECTS.hr}&page=1`)), "not_found");
    assert.equal((await jonas.get(`/activity?project=${PROJECTS.portal}&page=1`)).status, 403, "viewers cannot read the activity log");
    assert.equal(errorCode(await jonas.get(`/activity?project=${PROJECTS.portal}&page=1`)), "forbidden");
    assert.equal((await priya.get(`/activity?project=${PROJECTS.portal}&page=1`)).status, 403, "editors cannot read the activity log");
    assert.equal((await maya.get(`/activity?project=${PROJECTS.portal}&page=1`)).status, 403, "admins cannot read another owner's log");
  });

  it("optionally groups scopes and revisions into phases", async () => {
    const created = data(await daniel.post("/projects", { name: "Phases Lab" }));
    const [general] = data(await daniel.get(`/projects/${created.uuid}/sections`));
    assert.equal(general.phaseUuid, null);
    assert.deepEqual(data(await daniel.get(`/projects/${created.uuid}/phases`)), []);

    const foundation = data(await daniel.post(`/projects/${created.uuid}/phases`, { title: "Foundation" }));
    const delivery = data(await daniel.post(`/projects/${created.uuid}/phases`, { title: "Delivery", color: "#be185d" }));
    assert.equal(foundation.position, 0);
    assert.equal(foundation.color, "indigo");
    assert.equal(delivery.position, 1);
    assert.equal(delivery.color, "#be185d");
    assert.ok(!("id" in foundation) && !("projectId" in foundation));

    const revision = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "UAT notes", kind: "revision", phaseUuid: delivery.uuid }));
    assert.equal(revision.kind, "revision");
    assert.equal(revision.phaseUuid, delivery.uuid);
    assert.equal(data(await daniel.patch(`/sections/${general.uuid}`, { phaseUuid: foundation.uuid })).phaseUuid, foundation.uuid);

    const other = data(await daniel.post("/projects", { name: "Other Lab" }));
    const foreign = data(await daniel.post(`/projects/${other.uuid}/phases`, { title: "Elsewhere" }));
    const bad = await daniel.patch(`/sections/${general.uuid}`, { phaseUuid: foreign.uuid });
    assert.equal(bad.status, 422);
    assert.deepEqual(errorFields(bad), ["phaseUuid"]);

    const renamed = data(await daniel.patch(`/phases/${delivery.uuid}`, { title: "Acceptance" }));
    assert.equal(renamed.title, "Acceptance");
    assert.equal(renamed.color, "#be185d");
    const recoloured = data(await daniel.patch(`/phases/${delivery.uuid}`, { color: "teal" }));
    assert.equal(recoloured.color, "teal");
    assert.equal(recoloured.title, "Acceptance");
    assert.equal((await daniel.patch(`/phases/${delivery.uuid}`, { color: "not-a-color" })).status, 422);
    assert.equal((await daniel.patch(`/phases/${delivery.uuid}`, {})).status, 422);

    const reordered = data(await daniel.post(`/projects/${created.uuid}/phases/reorder`, { orderedPhaseUuids: [delivery.uuid, foundation.uuid] }));
    assert.deepEqual(
      reordered.map((p: any) => p.uuid),
      [delivery.uuid, foundation.uuid],
    );

    assert.equal((await jonas.get(`/projects/${PROJECTS.portal}/phases`)).status, 200);
    assert.equal((await jonas.post(`/projects/${PROJECTS.portal}/phases`, { title: "Nope" })).status, 403);

    assert.equal((await daniel.delete(`/phases/${foundation.uuid}`)).status, 200);
    const after = data(await daniel.get(`/projects/${created.uuid}/sections`));
    assert.equal(after.find((s: any) => s.uuid === general.uuid).phaseUuid, null, "deleting a phase ungroups its sections");
    assert.equal(after.find((s: any) => s.uuid === revision.uuid).phaseUuid, delivery.uuid);

    const activity = data(await daniel.get(`/activity?project=${created.uuid}&type=project&page=1&perPage=25`));
    assert.ok(activity.some((a: any) => a.action === "phase.created" && a.subject === "Foundation"));
    assert.ok(activity.some((a: any) => a.action === "phase.deleted" && a.subject === "Foundation"));

    assert.equal((await daniel.delete(`/phases/${UNKNOWN_UUID}`)).status, 404);
    assert.equal((await daniel.post(`/projects/${created.uuid}/phases`, { title: "" })).status, 422);
    assert.equal(data(await daniel.patch(`/sections/${revision.uuid}`, { phaseUuid: null })).phaseUuid, null, "a section can be ungrouped without deleting the phase");
  });
});
