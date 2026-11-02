import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { data, DEFAULT_TEMPLATE_UUID, errorCode, errorFields, PROJECTS, startTestServer, UNKNOWN_UUID, type Client, type TestServer } from "./helpers.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("export", () => {
  let server: TestServer;
  let daniel: Client;
  let jonas: Client;
  let priya: Client;

  before(async () => {
    server = await startTestServer();
    [daniel, jonas, priya] = await Promise.all([server.client("daniel"), server.client("jonas"), server.client("priya")]);
  });
  after(() => server.close());

  it("lists templates with the default first and without layout JSON", async () => {
    const templates = data(await daniel.get("/export-templates"));
    assert.ok(templates.length >= 1);
    assert.equal(templates[0].uuid, DEFAULT_TEMPLATE_UUID);
    assert.equal(templates[0].isDefault, true);
    assert.ok(!("definition" in templates[0]) && !("id" in templates[0]));
  });

  it("generates a DOCX for any member and logs the export", async () => {
    const r = await daniel.post(`/projects/${PROJECTS.portal}/exports`, {});
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), DOCX);
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename="barangay-records-portal-scope-checklist-\d{4}-\d{2}-\d{2}\.docx"/);
    assert.equal(r.headers.get("x-export-template"), "Default");
    assert.equal(r.headers.get("x-export-sections"), "4");
    assert.equal(r.headers.get("x-export-tasks"), "18");
    const bytes = Buffer.from(r.raw);
    assert.ok(bytes.length > 5_000, "a real document was produced");
    assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "DOCX is a ZIP container");

    const viewer = await jonas.post(`/projects/${PROJECTS.portal}/exports`, {});
    assert.equal(viewer.status, 200, "viewers may export what they can read");

    const activity = data(await daniel.get(`/activity?project=${PROJECTS.portal}&type=project&page=1&perPage=5`));
    const logged = activity.find((a: any) => a.action === "export.generated");
    assert.ok(logged, "export.generated is logged");
    assert.equal(logged.meta.sections, 4);
    assert.equal(logged.meta.partial, false);
  });

  it("exports selected sections with options", async () => {
    const sections = data(await daniel.get(`/projects/${PROJECTS.portal}/sections`));
    const r = await daniel.post(`/projects/${PROJECTS.portal}/exports`, {
      sectionUuids: [sections[0].uuid, sections[2].uuid],
      includeDescriptions: false,
      includeSignature: false,
      templateUuid: DEFAULT_TEMPLATE_UUID,
      timeZone: "Europe/London",
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-export-sections"), "2");
    const tasks = Number(r.headers.get("x-export-tasks"));
    assert.ok(tasks > 0 && tasks < 18);
  });

  it("validates the body and the selection", async () => {
    const unknownSection = await daniel.post(`/projects/${PROJECTS.portal}/exports`, { sectionUuids: [UNKNOWN_UUID] });
    assert.equal(unknownSection.status, 422);
    assert.deepEqual(errorFields(unknownSection), ["sectionUuids"]);
    assert.equal((await daniel.post(`/projects/${PROJECTS.portal}/exports`, { sectionUuids: [] })).status, 422);
    assert.equal((await daniel.post(`/projects/${PROJECTS.portal}/exports`, { timeZone: "Mars/Olympus" })).status, 422);
    assert.equal((await daniel.post(`/projects/${PROJECTS.portal}/exports`, { templateUuid: UNKNOWN_UUID })).status, 422);
    assert.equal((await daniel.post(`/projects/${PROJECTS.portal}/exports`, { surprise: true })).status, 422);
    assert.equal(unknownSection.headers.get("content-type")?.includes("application/json"), true, "errors keep the JSON envelope");
  });

  it("hides projects the caller cannot see and requires a session", async () => {
    assert.equal((await priya.post(`/projects/${PROJECTS.treasury}/exports`, {})).status, 200, "editor");
    assert.equal((await jonas.post(`/projects/${PROJECTS.hr}/exports`, {})).status, 404, "non-member");
    const anon = await server.client();
    const r = await anon.post(`/projects/${PROJECTS.portal}/exports`, {});
    assert.equal(r.status, 401);
    assert.equal(errorCode(r), "unauthenticated");
  });
});
