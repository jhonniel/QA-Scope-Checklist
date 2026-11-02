import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PRODUCTIVITY_WEIGHTS, parseProductivityWeights, productivityBucket, productivityScore, type ChecklistSection, type Project, type Task, type UserSummary } from "@scope/contracts";
import { renderSql } from "../src/db/migrator.ts";
import { fromSqlDateTime, splitStatements, toPositionalPlaceholders, toSqlDateTime } from "../src/db/database.ts";
import { withReturningId } from "../src/db/drivers/postgres.ts";
import { DomainError, NotFoundError, ValidationError } from "../src/domain/errors.ts";
import { errorHandler, type CaughtError } from "../src/http/middleware/errors.ts";
import { buildChecklistDocument, countItems, documentFileName } from "../src/domain/export/document.ts";
import { DEFAULT_TEMPLATE_DEFINITION, parseTemplateDefinition } from "../src/domain/export/template.ts";
import { generateToken, hashPassword, hashToken, verifyPassword } from "../src/domain/services/password.ts";
import { createExportSchema, parse, registerSchema, updateTaskSchema } from "../src/http/validate.ts";

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
    { uuid: "s1", projectUuid: project.uuid, title: "First", description: "  Desc ", position: 0 },
    { uuid: "s2", projectUuid: project.uuid, title: "Second", description: null, position: 1 },
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
    const doc = buildChecklistDocument({ project, sections, tasks, options: { includeDescriptions: false, includeSignature: true, timeZone: "UTC" }, generatedBy: owner, generatedAt: new Date("2026-11-02T00:00:00Z") });
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
    const doc = buildChecklistDocument({ project, sections, tasks, options: { includeDescriptions: true, includeSignature: false, timeZone: "UTC" }, generatedBy: owner });
    assert.equal(doc.sections[0].items[0].description, "Details");
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
});
