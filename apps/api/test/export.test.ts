import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { inflateRawSync } from "node:zlib";
import { data, DEFAULT_TEMPLATE_UUID, errorCode, errorFields, PROJECTS, startTestServer, UNKNOWN_UUID, type Client, type TestServer } from "./helpers.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Distinct `word/media/*` entries in the DOCX ZIP (each appears twice: local header + central directory). */
function mediaFiles(bytes: Buffer): string[] {
  const names = bytes.toString("latin1").match(/word\/media\/\w+\.png/g) ?? [];
  return [...new Set(names)];
}

/** Extract one entry of a ZIP (DOCX) by walking the central directory; enough for inspecting `word/document.xml`. */
function zipEntry(bytes: Buffer, name: string): string {
  let eocd = bytes.length - 22;
  while (eocd >= 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  assert.ok(eocd >= 0, "ZIP end-of-central-directory record found");
  let pos = bytes.readUInt32LE(eocd + 16);
  while (pos < eocd && bytes.readUInt32LE(pos) === 0x02014b50) {
    const method = bytes.readUInt16LE(pos + 10);
    const compressedSize = bytes.readUInt32LE(pos + 20);
    const nameLength = bytes.readUInt16LE(pos + 28);
    const extraLength = bytes.readUInt16LE(pos + 30);
    const commentLength = bytes.readUInt16LE(pos + 32);
    const localOffset = bytes.readUInt32LE(pos + 42);
    const entryName = bytes.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    if (entryName === name) {
      const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${name} not found in ZIP`);
}

/** "Nov 1, 2026, 12:16 AM" — the timestamp printed under a ticked box. */
const CHECK_TIMESTAMP = /\w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M/;

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
    assert.equal(mediaFiles(bytes).length, 2, "the letterhead logo and the progress chart are embedded by default");
    assert.match(zipEntry(bytes, "word/document.xml"), CHECK_TIMESTAMP, "ticked boxes carry the logged date, time and name by default");

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
      includeSignature: false, // legacy option: still accepted, ignored
      includeChart: false,
      templateUuid: DEFAULT_TEMPLATE_UUID,
      timeZone: "Europe/London",
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-export-sections"), "2");
    const tasks = Number(r.headers.get("x-export-tasks"));
    assert.ok(tasks > 0 && tasks < 18);
    assert.equal(mediaFiles(Buffer.from(r.raw)).length, 1, "only the logo remains when includeChart is false");
  });

  it("prints revision sections in their own block with their own chart", async () => {
    const created = data(await daniel.post("/projects", { name: "Revisions Lab" }));
    const [general] = data(await daniel.get(`/projects/${created.uuid}/sections`));
    await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: general.uuid, title: "Agreed scope item" });
    const revision = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "Client feedback round 1", kind: "revision" }));
    const fix = data(await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: revision.uuid, title: "Rename the Pending status" }));
    await daniel.patch(`/tasks/${fix.uuid}`, { status: "done" });

    const r = await daniel.post(`/projects/${created.uuid}/exports`, { timeZone: "Asia/Manila" });
    assert.equal(r.status, 200);
    const bytes = Buffer.from(r.raw);
    assert.equal(mediaFiles(bytes).length, 3, "logo, scope chart and revision chart");
    const xml = zipEntry(bytes, "word/document.xml");
    assert.ok(xml.includes(">Revisions<"), "the Revisions heading is printed");
    assert.ok(xml.includes(">Revision progress<"), "the revision chart has its own heading");
    const today = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" }).format(new Date());
    assert.ok(xml.includes(`>Revision as of ${today}<`), "a finished revision's table opens with its completion date as the banner");
    assert.ok(xml.includes(`<w:gridSpan w:val="4"/>`), "the banner spans the full table width");
    assert.ok(!xml.includes("Client feedback round 1"), "the date banner replaces the numbered title row of a finished revision");
    assert.ok(xml.includes("1. General"), "scope sections keep plain numbers");
    assert.ok(xml.indexOf("Agreed scope item") < xml.indexOf(">Revisions<") && xml.indexOf(">Revisions<") < xml.indexOf("Rename the Pending status"), "scope first, revisions after");

    // An unfinished revision is titled by name until its items are all resolved; each revision gets its own table.
    const pending = data(await daniel.post(`/projects/${created.uuid}/sections`, { title: "Client feedback round 2", kind: "revision" }));
    await daniel.post(`/projects/${created.uuid}/tasks`, { sectionUuid: pending.uuid, title: "Second-round fix" });
    const both = zipEntry(Buffer.from((await daniel.post(`/projects/${created.uuid}/exports`, { timeZone: "Asia/Manila" })).raw), "word/document.xml");
    assert.ok(both.includes(">Client feedback round 2<"), "the open revision's banner is its title");
    assert.equal(both.split(">Checked by<").length - 1, 3, "scope table plus one table per revision");
    assert.equal(both.split(`>Revision as of ${today}<`).length - 1, 1, "only the finished revision carries a date");

    const onlyRevision = await daniel.post(`/projects/${created.uuid}/exports`, { sectionUuids: [revision.uuid] });
    const onlyXml = zipEntry(Buffer.from(onlyRevision.raw), "word/document.xml");
    assert.ok(!onlyXml.includes("Agreed scope item") && onlyXml.includes("Rename the Pending status"), "a revisions-only export skips the empty scope table");
    assert.equal(mediaFiles(Buffer.from(onlyRevision.raw)).length, 2, "logo and the revision chart only");
  });

  it("can leave the name and date off ticked boxes", async () => {
    const r = await daniel.post(`/projects/${PROJECTS.portal}/exports`, { includeCheckDetails: false });
    assert.equal(r.status, 200);
    const xml = zipEntry(Buffer.from(r.raw), "word/document.xml");
    assert.doesNotMatch(xml, CHECK_TIMESTAMP, "no timestamps under the boxes");
    assert.ok(xml.includes("w14:checkbox"), "the checkbox controls themselves are still there");
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
