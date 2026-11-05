import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import { PRODUCTIVITY_WEIGHTS, SECTION_TITLE_MAX_LENGTH, groupSectionsByPhase, normalizeHttpUrl, parseProductivityWeights, productivityBucket, productivityScore, revisionAsOf, sectionReferenceSummary, type ChecklistSection, type Phase, type Project, type Task, type UserSummary } from "@scope/contracts";
import { renderSql } from "../src/db/migrator.ts";
import { fromSqlDateTime, splitStatements, toPositionalPlaceholders, toSqlDateTime } from "../src/db/database.ts";
import { withReturningId } from "../src/db/drivers/postgres.ts";
import { DomainError, NotFoundError, ValidationError } from "../src/domain/errors.ts";
import { errorHandler, type CaughtError } from "../src/http/middleware/errors.ts";
import { isLanHttpOrigin } from "../src/http/middleware/security.ts";
import { renderLabeledPieChartPng, renderPieChartPng, statusBreakdown } from "../src/domain/export/chart.ts";
import { buildChecklistDocument, countItems, documentFileName, groupByPhaseTitle, sectionsOfKind } from "../src/domain/export/document.ts";
import { pngSize } from "../src/domain/export/DocumentGenerator.ts";
import { DEFAULT_TEMPLATE_DEFINITION, parseTemplateDefinition } from "../src/domain/export/template.ts";
import { signInBlockError, signInBlockReason } from "../src/domain/accountAccess.ts";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../src/domain/services/password.ts";
import { createExportSchema, createSectionReferenceSchema, createSectionSchema, parse, registerSchema, updateTaskSchema } from "../src/http/validate.ts";

describe("account access", () => {
  it("blocks disabled accounts before pending ones", () => {
    assert.equal(signInBlockReason({ disabled_at: "2026-01-01 00:00:00", approved_at: null }), "disabled");
    assert.equal(signInBlockReason({ disabled_at: null, approved_at: null }), "pending");
    assert.equal(signInBlockReason({ disabled_at: null, approved_at: "2026-01-01 00:00:00" }), null);
    assert.equal(signInBlockError("pending").code, "account_pending");
    assert.equal(signInBlockError("pending").status, 403);
    assert.equal(signInBlockError("disabled").code, "account_disabled");
  });
});

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", async () => {
    const stored = await hashPassword("correct horse battery");
    assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    assert.equal(await verifyPassword("correct horse battery", stored), true);
    assert.equal(await verifyPassword("Correct horse battery", stored), false);
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
  });

  it("salts every hash and issues unpredictable tokens", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    assert.notEqual(a, b);
    const t1 = generateToken();
    const t2 = generateToken();
    assert.notEqual(t1, t2);
    assert.ok(t1.length >= 43, "256 bits of base64url");
    assert.equal(hashToken(t1), hashToken(t1));
    assert.notEqual(hashToken(t1), hashToken(t2));
  });
});

describe("migration SQL rendering", () => {
  it("renders dialect tokens per driver", () => {
    const sql = "CREATE TABLE t (id {{PK}}, user_id {{FK}}, flags {{JSON}}, ok {{BOOL}}){{ENGINE}}";
    const mysql = renderSql(sql, "mysql");
    assert.match(mysql, /BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/);
    assert.match(mysql, /ENGINE=InnoDB/);
    const sqlite = renderSql(sql, "sqlite");
    assert.match(sqlite, /INTEGER PRIMARY KEY AUTOINCREMENT/);
    assert.match(sqlite, /flags TEXT/);
    assert.ok(sqlite.endsWith(")"), "no engine clause on SQLite");
  });

  it("rejects unknown tokens", () => {
    assert.throws(() => renderSql("{{NOPE}}", "sqlite"), /Unknown migration token/);
  });

  it("renders PostgreSQL DDL from the MySQL-shaped files", () => {
    const sql = [
      "CREATE TABLE t (",
      "  id         {{PK}},",
      "  user_id    {{FK}} NULL,",
      "  meta       {{JSON}} NULL,",
      "  is_default {{BOOL}} NOT NULL DEFAULT 0,",
      "  archived   {{BOOL}} NOT NULL DEFAULT 1,",
      "  created_at DATETIME NOT NULL",
      "){{ENGINE}};",
      "ALTER TABLE t ADD COLUMN disabled_at DATETIME NULL;",
    ].join("\n");
    const pg = renderSql(sql, "postgres");
    assert.match(pg, /id\s+BIGSERIAL PRIMARY KEY/);
    assert.match(pg, /user_id\s+BIGINT NULL/);
    assert.match(pg, /meta\s+JSONB NULL/);
    assert.match(pg, /is_default BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(pg, /archived\s+BOOLEAN NOT NULL DEFAULT TRUE/);
    assert.match(pg, /created_at TIMESTAMP NOT NULL\n\);/);
    assert.match(pg, /disabled_at TIMESTAMP NULL/);
    assert.doesNotMatch(pg, /DATETIME|ENGINE/);
    // Other dialects are untouched by the PostgreSQL rewrites.
    assert.match(renderSql(sql, "mysql"), /is_default TINYINT\(1\) NOT NULL DEFAULT 0/);
    assert.match(renderSql(sql, "sqlite"), /created_at DATETIME NOT NULL/);
  });

  it("widens section titles per dialect", () => {
    const sql = "{{WIDEN_SECTION_TITLE}};";
    assert.match(renderSql(sql, "postgres"), /ALTER COLUMN title TYPE VARCHAR\(500\)/);
    assert.match(renderSql(sql, "mysql"), /MODIFY COLUMN title VARCHAR\(500\) NOT NULL/);
    assert.match(renderSql(sql, "sqlite"), /SELECT 1/);
  });
});

describe("database configuration gate", () => {
  const session = { provider: "session" as const, clerk: { publishableKey: "", secretKey: "", jwtKey: "", clockSkewMs: 60_000 } };
  const secure = { appUrl: "https://scope.example.gov.ph", allowedOrigins: ["https://scope.example.gov.ph"] };

  it("accepts PostgreSQL in production with a password or a connection string", async () => {
    const { productionConfigProblems, config } = await import("../src/config.ts");
    const base = { ...config, ...secure, env: "production" as const, auth: session, session: { ...config.session, secureCookie: true } };
    const withPassword = productionConfigProblems({ ...base, db: { ...config.db, client: "postgres", password: "s3cret", url: "" } });
    assert.deepEqual(withPassword, []);
    const withUrl = productionConfigProblems({ ...base, db: { ...config.db, client: "postgres", password: "", url: "postgres://u:p@db:5432/scope" } });
    assert.deepEqual(withUrl, []);
    const bare = productionConfigProblems({ ...base, db: { ...config.db, client: "postgres", password: "", url: "" } });
    assert.ok(bare.some((p) => p.includes("DB_PASSWORD is empty")));
  });

  it("refuses sqlite in production and points the operator at postgres", async () => {
    const { productionConfigProblems, config } = await import("../src/config.ts");
    const problems = productionConfigProblems({
      ...config,
      ...secure,
      env: "production",
      auth: session,
      session: { ...config.session, secureCookie: true },
      db: { ...config.db, client: "sqlite", password: "", url: "" },
    });
    assert.ok(problems.some((p) => p.includes("DB_CLIENT=sqlite") && p.includes("postgres")));
  });
});

describe("SQL script and placeholder helpers", () => {
  it("splits scripts on statement boundaries and drops line comments", () => {
    const script = [
      "-- Users; the `uuid` column is public.",
      "CREATE TABLE a (id INT, note VARCHAR(10) DEFAULT 'x;y'); -- trailing; comment",
      "CREATE INDEX a_idx ON a (id);",
      "",
    ].join("\n");
    assert.deepEqual(splitStatements(script), ["CREATE TABLE a (id INT, note VARCHAR(10) DEFAULT 'x;y')", "CREATE INDEX a_idx ON a (id)"]);
  });

  it("rewrites ? placeholders to $n outside quotes", () => {
    assert.equal(toPositionalPlaceholders("SELECT * FROM t WHERE a = ? AND b = ?"), "SELECT * FROM t WHERE a = $1 AND b = $2");
    assert.equal(toPositionalPlaceholders("SELECT '?' AS q, \"?\" FROM t WHERE a = ?"), "SELECT '?' AS q, \"?\" FROM t WHERE a = $1");
    assert.equal(toPositionalPlaceholders("SELECT 1"), "SELECT 1");
  });

  it("adds RETURNING id to inserts only", () => {
    assert.equal(withReturningId("INSERT INTO t (a) VALUES ($1);"), "INSERT INTO t (a) VALUES ($1) RETURNING id");
    assert.equal(withReturningId("  insert into t (a) values ($1) returning uuid"), "insert into t (a) values ($1) returning uuid");
    assert.equal(withReturningId("UPDATE t SET a = $1 WHERE id = $2"), "UPDATE t SET a = $1 WHERE id = $2");
    assert.equal(withReturningId("DELETE FROM t WHERE id = $1"), "DELETE FROM t WHERE id = $1");
  });
});

describe("SQL date helpers", () => {
  it("converts to UTC DATETIME strings and back", () => {
    const date = new Date(Date.UTC(2026, 10, 2, 4, 5, 6));
    const sql = toSqlDateTime(date);
    assert.equal(sql, "2026-11-02 04:05:06");
    assert.equal(new Date(fromSqlDateTime(sql)!).getTime(), date.getTime());
    assert.equal(fromSqlDateTime(null), null);
  });
});

describe("productivity scoring", () => {
  it("classifies activity-log actions into weighted buckets", () => {
    assert.equal(productivityBucket("task.status_changed", { from: "for_qa", to: "done" }), "tasksCompleted");
    assert.equal(productivityBucket("task.status_changed", { from: "done", to: "for_revision" }), "tasksUpdated", "re-opening is not a completion");
    assert.equal(productivityBucket("task.status_changed", { to: "not_applicable" }), "tasksCompleted");
    assert.equal(productivityBucket("task.status_changed", null), "tasksUpdated", "missing meta is tolerated");
    assert.equal(productivityBucket("task.checked", {}), "tasksChecked");
    assert.equal(productivityBucket("task.unchecked", {}), "tasksUpdated");
    assert.equal(productivityBucket("task.created", {}), "tasksCreated");
    assert.equal(productivityBucket("comment.added", {}), "comments");
    assert.equal(productivityBucket("section.note_added", {}), "comments");
    assert.equal(productivityBucket("section.link_added", {}), "comments");
    assert.equal(productivityBucket("export.generated", {}), "exports");
    assert.equal(productivityBucket("section.created", {}), "other");
  });

  it("weights completions above everything else", () => {
    const empty = { tasksCompleted: 0, tasksChecked: 0, tasksCreated: 0, tasksUpdated: 0, comments: 0, exports: 0, other: 0 };
    assert.equal(productivityScore(empty), 0);
    assert.equal(productivityScore({ ...empty, tasksCompleted: 2, comments: 3 }), 2 * PRODUCTIVITY_WEIGHTS.tasksCompleted + 3 * PRODUCTIVITY_WEIGHTS.comments);
    assert.ok(PRODUCTIVITY_WEIGHTS.tasksCompleted > PRODUCTIVITY_WEIGHTS.tasksChecked && PRODUCTIVITY_WEIGHTS.tasksChecked > PRODUCTIVITY_WEIGHTS.tasksCreated);
    assert.equal(productivityScore({ ...empty, comments: 3 }, { ...PRODUCTIVITY_WEIGHTS, comments: 4 }), 12, "custom weights are honoured");
  });

  it("parses PRODUCTIVITY_WEIGHTS overrides and rejects typos", () => {
    assert.deepEqual(parseProductivityWeights(undefined), PRODUCTIVITY_WEIGHTS);
    assert.deepEqual(parseProductivityWeights("   "), PRODUCTIVITY_WEIGHTS);
    assert.deepEqual(parseProductivityWeights("tasksCompleted=8, comments=2"), { ...PRODUCTIVITY_WEIGHTS, tasksCompleted: 8, comments: 2 });
    assert.deepEqual(parseProductivityWeights("exports=0"), { ...PRODUCTIVITY_WEIGHTS, exports: 0 }, "a bucket can be switched off");
    assert.notEqual(parseProductivityWeights("other=9"), PRODUCTIVITY_WEIGHTS, "defaults are never mutated");
    assert.equal(PRODUCTIVITY_WEIGHTS.other, 1);
    assert.throws(() => parseProductivityWeights("taskCompleted=8"), /unknown bucket "taskCompleted"/);
    assert.throws(() => parseProductivityWeights("tasksCompleted=high"), /non-negative whole number/);
    assert.throws(() => parseProductivityWeights("tasksCompleted=-1"), /non-negative whole number/);
    assert.throws(() => parseProductivityWeights("tasksCompleted"), /expected "bucket=points"/);
  });
});

describe("error handler", () => {
  function run(error: unknown) {
    const recorded: CaughtError[] = [];
    const logged: string[] = [];
    const handler = errorHandler({ log: (m) => logged.push(m), record: (c) => void recorded.push(c) });
    let status = 0;
    let body: any = null;
    const res = { status: (s: number) => ((status = s), res), json: (b: unknown) => ((body = b), res) };
    const req = { method: "PATCH", originalUrl: "/api/tasks/abc?x=1", get: () => "TestAgent/1.0", auth: { actor: { id: 7 } } };
    handler(error, req as any, res as any, () => {});
    return { status, body, recorded, logged };
  }

  it("does not record expected 4xx outcomes", () => {
    const r = run(new NotFoundError("Task was not found."));
    assert.equal(r.status, 404);
    assert.equal(r.recorded.length, 0);
    assert.equal(r.logged.length, 0);
  });

  it("records unexpected failures with request context and keeps the response generic", () => {
    const boom = new TypeError("Cannot read properties of undefined");
    const r = run(boom);
    assert.equal(r.status, 500);
    assert.equal(r.body.error.code, "server_error");
    assert.ok(!r.body.error.message.includes("undefined"), "internal details never reach the client");
    assert.deepEqual(r.logged, ["Unhandled error"]);
    assert.equal(r.recorded.length, 1);
    const [c] = r.recorded;
    assert.equal(c.status, 500);
    assert.equal(c.code, "server_error");
    assert.equal(c.name, "TypeError");
    assert.equal(c.message, boom.message);
    assert.equal(c.stack, boom.stack);
    assert.equal(c.method, "PATCH");
    assert.equal(c.path, "/api/tasks/abc", "query string is dropped");
    assert.equal(c.actorId, 7);
    assert.equal(c.userAgent, "TestAgent/1.0");
  });

  it("records domain-level 5xx errors too", () => {
    const r = run(new DomainError(503, "mail_unavailable", "Mail could not be sent."));
    assert.equal(r.status, 503);
    assert.equal(r.recorded.length, 1);
    assert.equal(r.recorded[0].code, "mail_unavailable");
  });

  it("survives a failing recorder", () => {
    const handler = errorHandler({
      log: () => {},
      record: () => {
        throw new Error("db down");
      },
    });
    let status = 0;
    const res = { status: (s: number) => ((status = s), res), json: () => res };
    handler(new Error("x"), { method: "GET", originalUrl: "/api/x", get: () => undefined } as any, res as any, () => {});
    assert.equal(status, 500);
  });
});

describe("LAN origins", () => {
  it("accepts loopback and RFC1918 http(s) origins", () => {
    assert.equal(isLanHttpOrigin("http://192.168.1.24:5173"), true);
    assert.equal(isLanHttpOrigin("http://10.0.0.8:5173"), true);
    assert.equal(isLanHttpOrigin("https://172.16.0.2"), true);
    assert.equal(isLanHttpOrigin("http://localhost:5173"), true);
    assert.equal(isLanHttpOrigin("https://evil.example"), false);
    assert.equal(isLanHttpOrigin("http://172.32.0.1"), false);
  });
});

describe("request validation", () => {
  it("normalises e-mails and reports every field", () => {
    const parsed = parse(registerSchema, { name: "  Ada  ", email: "  Ada@Example.COM ", password: "longenough" });
    assert.equal(parsed.name, "Ada");
    assert.equal(parsed.email, "ada@example.com");
    try {
      parse(registerSchema, { name: "A", email: "nope", password: "short" });
      assert.fail("should throw");
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.status, 422);
      assert.deepEqual(
        error.fields?.map((f) => f.field).sort(),
        ["email", "name", "password"],
      );
    }
  });

  it("accepts a long scope title and rejects one over the limit", () => {
    const title = "x".repeat(SECTION_TITLE_MAX_LENGTH);
    assert.equal(parse(createSectionSchema, { title }).title.length, SECTION_TITLE_MAX_LENGTH);
    try {
      parse(createSectionSchema, { title: `${title}y` });
      assert.fail("should throw");
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.fields, [{ field: "title", message: `Use at most ${SECTION_TITLE_MAX_LENGTH} characters.` }]);
    }
  });

  it("normalizes http(s) links and rejects other schemes", () => {
    assert.equal(normalizeHttpUrl("https://example.com/sheet"), "https://example.com/sheet");
    assert.equal(normalizeHttpUrl("example.com/sheet"), "https://example.com/sheet");
    assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
    assert.equal(normalizeHttpUrl("   "), null);
    assert.equal(sectionReferenceSummary([{ kind: "note" }, { kind: "note" }, { kind: "link" }]), "2 notes · 1 link");
    assert.equal(sectionReferenceSummary([]), null);
  });

  it("accepts an optional note or link when creating a scope", () => {
    const parsed = parse(createSectionSchema, { title: "Kickoff", reference: { kind: "note", body: "  Hold the dry-run.  " } });
    assert.deepEqual(parsed.reference, { kind: "note", body: "Hold the dry-run.", title: null });
    try {
      parse(createSectionSchema, { title: "Kickoff", reference: { kind: "link", body: "not a url" } });
      assert.fail("should throw");
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.fields, [{ field: "reference.body", message: "Enter a valid http or https link." }]);
    }
  });

  it("accepts a note or an http(s) link on a scope", () => {
    assert.deepEqual(parse(createSectionReferenceSchema, { kind: "note", body: "  Hold the dry-run.  " }), { kind: "note", body: "Hold the dry-run.", title: null });
    const link = parse(createSectionReferenceSchema, { kind: "link", body: "drive.example.com/map", title: " Mapping " });
    assert.equal(link.kind, "link");
    assert.equal(link.body, "https://drive.example.com/map");
    assert.equal(link.title, "Mapping");
    try {
      parse(createSectionReferenceSchema, { kind: "link", body: "not a url" });
      assert.fail("should throw");
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.deepEqual(error.fields, [{ field: "body", message: "Enter a valid http or https link." }]);
    }
  });

  it("keeps strict bodies strict", () => {
    assert.throws(() => parse(updateTaskSchema, { developerCheckedAt: "2026-01-01" }), ValidationError);
    assert.throws(() => parse(createExportSchema, { sectionUuids: [] }), ValidationError);
    assert.deepEqual(parse(updateTaskSchema, { developerChecked: true }), { developerChecked: true });
  });
});

describe("export document model", () => {
  const user = (name: string): UserSummary => ({ uuid: `00000000-0000-4000-8000-00000000000${name.length}`, name, email: `${name.toLowerCase()}@example.com`, avatarUrl: null });
  const owner = user("Owner");
  const project = {
    uuid: "c3c30000-0000-4000-8000-000000000099",
    name: "Résumé Builder: Phase 2 / Final!",
    description: "   ",
    owner,
    status: "active",
    startDate: "2026-01-01",
    deadline: null,
    members: [],
    stats: { totalTasks: 0, completedTasks: 0, completionPercent: 0, sectionCount: 0, overdueTasks: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Project;
  const sections = [
    { uuid: "s1", projectUuid: project.uuid, title: "First", description: "  Desc ", kind: "scope", position: 0, completedAt: null },
    { uuid: "s2", projectUuid: project.uuid, title: "Second", description: null, kind: "scope", position: 1, completedAt: "2026-07-17T02:00:00.000Z" },
  ] as unknown as ChecklistSection[];
  const task = (uuid: string, sectionUuid: string, position: number, extra: Partial<Task> = {}): Task =>
    ({
      uuid,
      projectUuid: project.uuid,
      sectionUuid,
      title: `Task ${uuid}`,
      description: "Details",
      status: "not_started",
      developerCheck: null,
      clientCheck: null,
      dueDate: null,
      priority: "medium",
      assignee: null,
      position,
      commentCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    }) as Task;
  const tasks = [
    task("b", "s1", 1),
    task("a", "s1", 0, { developerCheck: { checkedBy: user("Dev"), checkedAt: "2026-02-01T10:00:00.000Z" } }),
    task("c", "s2", 0),
    task("zzz", "other-section", 0),
  ];

  it("groups tasks under sections in stored order and applies options", () => {
    const doc = buildChecklistDocument({ project, sections, tasks, options: { includeDescriptions: false, includeCheckDetails: true, includeChart: true, timeZone: "UTC" }, generatedBy: owner, generatedAt: new Date("2026-11-02T00:00:00Z") });
    assert.equal(doc.description, null, "blank descriptions become null");
    assert.equal(doc.sections.length, 2);
    assert.deepEqual(doc.sections.map((s) => s.number), [1, 2]);
    assert.equal(doc.sections[0].description, "Desc");
    assert.deepEqual(
      doc.sections[0].items.map((i) => i.title),
      ["Task a", "Task b"],
      "sorted by position",
    );
    assert.equal(doc.sections[0].items[0].developerCheck?.checkedBy, "Dev");
    assert.equal(doc.sections[0].items[0].description, null, "descriptions excluded by option");
    assert.equal(countItems(doc), 3, "tasks outside the selected sections are dropped");
    assert.equal(documentFileName(doc, "docx"), "resume-builder-phase-2-final-scope-checklist-2026-11-02.docx");
  });

  it("includes descriptions when asked", () => {
    const doc = buildChecklistDocument({ project, sections, tasks, options: { includeDescriptions: true, includeCheckDetails: true, includeChart: true, timeZone: "UTC" }, generatedBy: owner });
    assert.equal(doc.sections[0].items[0].description, "Details");
  });

  it("numbers scope sections and revisions separately and keeps them apart", () => {
    const mixed = [
      sections[0],
      { ...sections[1], uuid: "r1", title: "Fix A", kind: "revision" },
      { ...sections[1], uuid: "s3", title: "Third", position: 2 },
      { ...sections[1], uuid: "r2", title: "Fix B", kind: "revision", position: 3 },
    ] as unknown as ChecklistSection[];
    const doc = buildChecklistDocument({ project, sections: mixed, tasks: [task("x", "r1", 0, { status: "done" }), task("y", "s1", 0)], options: { includeDescriptions: true, includeCheckDetails: true, includeChart: true, timeZone: "UTC" }, generatedBy: owner });
    assert.deepEqual(
      doc.sections.map((s) => `${s.kind}:${s.number}`),
      ["scope:1", "revision:1", "scope:2", "revision:2"],
    );
    assert.deepEqual(
      doc.sections.map((s) => s.completedAt),
      [null, "2026-07-17T02:00:00.000Z", "2026-07-17T02:00:00.000Z", "2026-07-17T02:00:00.000Z"],
      "the completion date travels into the document model",
    );
    assert.deepEqual(
      doc.sections.map((s) => s.revisionDate),
      [null, null, null, null],
      "an undated section carries a null revision date",
    );
    assert.equal(revisionAsOf({ kind: "revision", revisionDate: "2026-08-01", completedAt: "2026-07-17T02:00:00.000Z" }), "2026-08-01", "the picked date wins");
    assert.equal(revisionAsOf({ kind: "revision", revisionDate: null, completedAt: "2026-07-17T02:00:00.000Z" }), "2026-07-17T02:00:00.000Z");
    assert.equal(revisionAsOf({ kind: "scope", revisionDate: "2026-08-01", completedAt: null }), null);
    assert.deepEqual(sectionsOfKind(doc, "revision").map((s) => s.title), ["Fix A", "Fix B"]);
    assert.equal(statusBreakdown({ sections: sectionsOfKind(doc, "revision") }).percent, 100, "the revision chart counts revision items only");
    assert.equal(statusBreakdown({ sections: sectionsOfKind(doc, "scope") }).percent, 0);
  });

  it("orders sections by optional phase and stamps phaseTitle", () => {
    const phases = [
      { uuid: "p-late", projectUuid: project.uuid, title: "Delivery", color: "teal", position: 1, createdAt: project.createdAt, updatedAt: project.updatedAt },
      { uuid: "p-first", projectUuid: project.uuid, title: "Foundation", color: "indigo", position: 0, createdAt: project.createdAt, updatedAt: project.updatedAt },
    ] as Phase[];
    const mixed = [
      { ...sections[0], uuid: "s-loose", title: "Loose", phaseUuid: null, position: 0 },
      { ...sections[0], uuid: "s-late", title: "Later", phaseUuid: "p-late", position: 1 },
      { ...sections[0], uuid: "s-first", title: "Early", phaseUuid: "p-first", position: 2 },
    ] as unknown as ChecklistSection[];
    const doc = buildChecklistDocument({ project, sections: mixed, phases, tasks: [], options: { includeDescriptions: false, includeCheckDetails: true, includeChart: false, timeZone: "UTC" }, generatedBy: owner });
    assert.deepEqual(
      doc.sections.map((s) => `${s.phaseTitle ?? "-"}:${s.title}`),
      ["Foundation:Early", "Delivery:Later", "-:Loose"],
    );
    assert.deepEqual(
      groupByPhaseTitle(doc.sections).map((g) => `${g.phaseTitle ?? "-"}:${g.sections.length}`),
      ["Foundation:1", "Delivery:1", "-:1"],
      "each phase becomes its own table so the name can sit above the headers",
    );
  });
});

describe("phase grouping", () => {
  const phase = (uuid: string, title: string, position: number): Phase => ({ uuid, projectUuid: "p", title, color: position === 0 ? "indigo" : "teal", position, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  const section = (uuid: string, position: number, phaseUuid: string | null) => ({ uuid, phaseUuid, position });

  it("keeps a flat list when the project has no phases", () => {
    const sections = [section("b", 1, null), section("a", 0, null)];
    assert.deepEqual(
      groupSectionsByPhase(sections, []).map((g) => ({ phase: g.phase, ids: g.sections.map((s) => s.uuid) })),
      [{ phase: null, ids: ["a", "b"] }],
    );
  });

  it("lists phases in order including empty ones, then the ungrouped tail", () => {
    const phases = [phase("p2", "Delivery", 1), phase("p1", "Foundation", 0)];
    const sections = [section("u", 0, null), section("d", 1, "p2"), section("f", 2, "p1")];
    const groups = groupSectionsByPhase(sections, phases);
    assert.deepEqual(
      groups.map((g) => [g.phase?.title ?? null, g.sections.map((s) => s.uuid)]),
      [
        ["Foundation", ["f"]],
        ["Delivery", ["d"]],
        [null, ["u"]],
      ],
    );
    assert.equal(groupSectionsByPhase([], phases).length, 2, "empty phases stay so they can be filled");
  });
});

describe("export progress chart", () => {
  const items = (statuses: string[]) => ({ sections: [{ items: statuses.map((status) => ({ status })) }] }) as unknown as Parameters<typeof statusBreakdown>[0];

  it("counts items by status in contract order, and the resolved share", () => {
    const summary = statusBreakdown(items(["done", "done", "done", "for_qa", "done_for_production", "done_for_production", "not_applicable"]));
    assert.equal(summary.total, 7);
    assert.equal(summary.resolved, 6, "done, done_for_production and not_applicable are resolved");
    assert.equal(summary.percent, 86);
    assert.deepEqual(
      summary.slices.map((s) => [s.status, s.count, s.percent]),
      [
        ["for_qa", 1, 14.3],
        ["done_for_production", 2, 28.6],
        ["done", 3, 42.9],
        ["not_applicable", 1, 14.3],
      ],
      "slices follow the contract status order, like an Excel category pie",
    );
    assert.deepEqual(statusBreakdown(items([])), { total: 0, resolved: 0, percent: 0, slices: [] });
  });

  it("renders a valid PNG with anti-aliased slices in the requested colours", () => {
    const size = 64;
    const png = renderPieChartPng([{ value: 3, color: "34A853" }, { value: 1, color: "F08C2E" }], { size });
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
    assert.equal(png.subarray(12, 16).toString("latin1"), "IHDR");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[24], 8, "8-bit");
    assert.equal(png[25], 6, "RGBA");
    assert.equal(png.subarray(png.length - 8, png.length - 4).toString("latin1"), "IEND");

    // Decode the IDAT payload and sample pixels: green covers 12 → 9 o'clock clockwise (75%), orange the last quarter (9 → 12), corners transparent.
    const idatLength = png.readUInt32BE(33);
    assert.equal(png.subarray(37, 41).toString("latin1"), "IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const pixel = (x: number, y: number) => {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      return [raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]];
    };
    assert.deepEqual(pixel(0, 0), [0, 0, 0, 0], "outside the circle is transparent");
    assert.deepEqual(pixel(48, 16), [0x34, 0xa8, 0x53, 255], "upper-right quadrant is the first (green) slice");
    assert.deepEqual(pixel(32, 48), [0x34, 0xa8, 0x53, 255], "bottom is still green");
    assert.deepEqual(pixel(16, 16), [0xf0, 0x8c, 0x2e, 255], "upper-left quadrant is the second (orange) slice");
    assert.throws(() => renderPieChartPng([{ value: 0, color: "000000" }]), /positive value/);
  });

  it("draws Excel-style callout labels beside a wider pie", () => {
    const labeled = renderLabeledPieChartPng(
      [
        { value: 1, color: "F08C2E", label: "For QA", percent: 2.1 },
        { value: 3, color: "2E9D4A", label: "Done (For Production)", percent: 6.4 },
        { value: 43, color: "34A853", label: "Done", percent: 91.5 },
      ],
      { pieSize: 160, background: "FFFFFF" },
    );
    assert.ok(labeled.width > labeled.pieSize, "labels sit outside the pie");
    assert.equal(labeled.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(labeled.png.readUInt32BE(16), labeled.width);
    assert.equal(labeled.png.readUInt32BE(20), labeled.height);
  });

  it("keeps chart colours valid when a template overrides them", () => {
    const merged = parseTemplateDefinition({ chart: { sizePt: 5000, colors: { done: "#1B5E20", for_qa: "nope" } } });
    assert.equal(merged.chart.colors.done, "1B5E20");
    assert.equal(merged.chart.colors.for_qa, DEFAULT_TEMPLATE_DEFINITION.chart.colors.for_qa);
    assert.equal(merged.chart.sizePt, DEFAULT_TEMPLATE_DEFINITION.chart.sizePt, "out-of-range size falls back");
    assert.equal(merged.chart.enabled, true);
  });
});

describe("export template definition", () => {
  it("deep-merges partial and legacy definitions over the defaults", () => {
    const merged = parseTemplateDefinition(JSON.stringify({ colors: { headerFill: "FF0000" }, labels: { remarks: "Status" } }));
    assert.equal(merged.colors.headerFill, "FF0000");
    assert.equal(merged.colors.border, DEFAULT_TEMPLATE_DEFINITION.colors.border);
    assert.equal(merged.labels.remarks, "Status");
    assert.equal(merged.labels.developer, DEFAULT_TEMPLATE_DEFINITION.labels.developer);
    assert.equal(merged.layout, "checked-by-table");
  });

  it("tolerates garbage", () => {
    assert.deepEqual(parseTemplateDefinition("not json"), DEFAULT_TEMPLATE_DEFINITION);
    assert.deepEqual(parseTemplateDefinition(null), DEFAULT_TEMPLATE_DEFINITION);
    assert.deepEqual(parseTemplateDefinition({ layout: "unknown-layout" }).layout, "checked-by-table");
  });

  it("ships a default whose column widths add up to 100", () => {
    const c = DEFAULT_TEMPLATE_DEFINITION.columns;
    assert.equal(c.developerPct + c.clientPct + c.itemPct + c.remarksPct, 100);
  });

  it("normalises the letterhead header block", () => {
    const merged = parseTemplateDefinition({
      header: { logo: "", logoWidthPt: 9999, organisation: ["  Acme Dev Team ", "", 42, "ISO 9001"], documentTitle: "Acceptance Checklist" },
    });
    assert.equal(merged.header.logo, "", "an empty logo name disables the logo");
    assert.equal(merged.header.logoWidthPt, DEFAULT_TEMPLATE_DEFINITION.header.logoWidthPt, "out-of-range width falls back");
    assert.deepEqual(merged.header.organisation, ["Acme Dev Team", "ISO 9001"], "blank and non-string lines are dropped");
    assert.equal(merged.header.documentTitle, "Acceptance Checklist");
    assert.equal(merged.header.connector, DEFAULT_TEMPLATE_DEFINITION.header.connector);
    // Legacy stored definitions had `header: { fill }`; the unknown key is ignored and the defaults survive.
    assert.deepEqual(parseTemplateDefinition({ header: { fill: "FF0000" } }).header, DEFAULT_TEMPLATE_DEFINITION.header);
  });

  it("reads PNG dimensions from the IHDR chunk", () => {
    const png = renderPieChartPng([{ value: 1, color: "000000" }], { size: 24 });
    assert.deepEqual(pngSize(png), { width: 24, height: 24 });
    assert.equal(pngSize(Buffer.from("not a png")), null);
  });
});
