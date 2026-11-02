import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChecklistSection, Project, Task, User } from "@scope/contracts";
import { RESOLVED_TASK_STATUSES, TASK_STATUSES, TASK_STATUS_LABELS } from "@scope/contracts";
import { routeDepth, routes, safeNext } from "@/app/routes";
import { daysUntil, formatDueDate, formatRelative, isOverdue, parseIsoDate, toIsoDate } from "@/lib/date";
import { canEditProject, canLeaveProject, canManageMembers, memberRole } from "@/lib/permissions";
import { normalizeQuery, projectMatches, searchWorkspace, taskMatches } from "@/lib/search";
import { computeStats, sectionProgress } from "@/lib/stats";
import { isResolved, statusLabel, TASK_STATUS_META } from "@/lib/taskStatus";
import { shouldCelebrate } from "@/lib/useCompletionCelebration";
import { ApiError } from "@/services/api/ApiError";

const user = (n: number, role: User["role"] = "user"): User => ({ uuid: `a1a10000-0000-4000-8000-00000000000${n}`, name: `User ${n}`, email: `u${n}@example.com`, role, avatarUrl: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
const summary = (u: User) => ({ uuid: u.uuid, name: u.name, email: u.email, avatarUrl: u.avatarUrl });
const task = (status: Task["status"], dueDate: string | null = null): Task =>
  ({ uuid: crypto.randomUUID(), projectUuid: "p", sectionUuid: "s", title: "t", description: null, status, developerCheck: null, clientCheck: null, dueDate, priority: "medium", assignee: null, position: 0, commentCount: 0, createdAt: "", updatedAt: "" }) as Task;

describe("completion celebration", () => {
  it("fires only when completion crosses into 100%", () => {
    assert.equal(shouldCelebrate(88, 100), true);
    assert.equal(shouldCelebrate(0, 100), true);
    assert.equal(shouldCelebrate(100, 100), false, "already complete");
    assert.equal(shouldCelebrate(undefined, 100), false, "first observation of a complete project");
    assert.equal(shouldCelebrate(100, 88), false, "unticking");
    assert.equal(shouldCelebrate(50, 75), false);
  });
});

describe("task status model", () => {
  it("has a label and colour for every status", () => {
    for (const s of TASK_STATUSES) {
      assert.equal(TASK_STATUS_META[s].label, TASK_STATUS_LABELS[s]);
      assert.match(TASK_STATUS_META[s].color, /^#[0-9a-f]{6}$/i);
      assert.equal(statusLabel(s), TASK_STATUS_LABELS[s]);
    }
  });

  it("resolves exactly the statuses the contract declares as resolved", () => {
    for (const s of TASK_STATUSES) assert.equal(isResolved({ status: s }), RESOLVED_TASK_STATUSES.includes(s), s);
  });
});

describe("stats", () => {
  it("computes completion, section count and overdue tasks", () => {
    // `computeStats` compares against the real clock, so build the fixture relative to today.
    const yesterday = toIsoDate(new Date(Date.now() - 86_400_000));
    const tomorrow = toIsoDate(new Date(Date.now() + 86_400_000));
    const tasks = [task("completed", yesterday), task("not_started", yesterday), task("in_development", tomorrow), task("done")];
    const sections = [{ uuid: "s" }, { uuid: "s2" }] as ChecklistSection[];
    const stats = computeStats(tasks, sections);
    assert.equal(stats.totalTasks, 4);
    assert.equal(stats.completedTasks, 2);
    assert.equal(stats.completionPercent, 50);
    assert.equal(stats.sectionCount, 2);
    assert.equal(stats.overdueTasks, 1, "resolved tasks are never overdue; future due dates are not overdue");
  });

  it("handles empty inputs", () => {
    assert.deepEqual(computeStats([], []), { totalTasks: 0, completedTasks: 0, completionPercent: 0, sectionCount: 0, overdueTasks: 0 });
    assert.deepEqual(sectionProgress([]), { total: 0, completed: 0, percent: 0 });
    assert.deepEqual(sectionProgress([task("done"), task("for_qa"), task("not_applicable")]), { total: 3, completed: 2, percent: 67 });
  });
});

describe("search", () => {
  const project = (uuid: string, name: string, description: string | null = null): Project => ({ uuid, name, description, ownerUuid: "o", stats: computeStats([], []), createdAt: "", updatedAt: "" }) as unknown as Project;
  const named = (projectUuid: string, title: string, extra: Partial<Task> = {}): Task => ({ ...task("not_started"), projectUuid, title, ...extra });

  it("matches tasks on title, description, status label and assignee, case- and space-insensitively", () => {
    const t = named("p1", "Login page", { description: "OAuth via Clerk", status: "for_qa", assignee: summary(user(1)) });
    assert.equal(normalizeQuery("  LoGin   "), "login");
    assert.equal(taskMatches(t, normalizeQuery("LOGIN")), true);
    assert.equal(taskMatches(t, "clerk"), true, "description");
    assert.equal(taskMatches(t, "for qa"), true, "status label");
    assert.equal(taskMatches(t, "user 1"), true, "assignee name");
    assert.equal(taskMatches(t, "payments"), false);
    assert.equal(taskMatches(t, ""), true, "an empty query matches everything so inline filters stay a no-op");
  });

  it("matches projects on name and description", () => {
    const p = project("p1", "Treasury portal", "Cash management for the LGU");
    assert.equal(projectMatches(p, "treasury"), true);
    assert.equal(projectMatches(p, "lgu"), true);
    assert.equal(projectMatches(p, "payroll"), false);
  });

  it("searches the whole workspace, ranks title matches first and caps the result", () => {
    const p2 = project("p2", "Payroll", "replaces the treasury spreadsheet");
    const p1 = project("p1", "Treasury portal");
    const sections = { p1: [{ uuid: "s", title: "Phase 1" }] as ChecklistSection[], p2: [] };
    const tasks = {
      p1: [named("p1", "Reconcile ledger", { description: "treasury export" }), named("p1", "Treasury dashboard")],
      p2: [named("p2", "Treasury import"), ...Array.from({ length: 10 }, (_, i) => named("p2", `Treasury row ${i}`))],
    };
    const empty = searchWorkspace("   ", [p2, p1], tasks, sections);
    assert.deepEqual(empty, { projects: [], sections: [], tasks: [], truncated: false }, "blank query yields nothing");

    const result = searchWorkspace("Treasury", [p2, p1], tasks, sections, { maxProjects: 4, maxTasks: 5 });
    assert.deepEqual(
      result.projects.map((p) => p.uuid),
      ["p1", "p2"],
      "name match ranks before description match even though p2 is listed first",
    );
    assert.equal(result.tasks.length, 5);
    assert.equal(result.truncated, true);
    assert.equal(result.tasks[0].task.title, "Treasury import", "tasks follow project order");
    assert.equal(result.tasks[0].project.uuid, "p2");
    assert.equal(result.tasks[0].section, undefined, "no section data loaded for p2");
    assert.equal(
      result.tasks.every((h) => h.task.title.toLowerCase().includes("treasury")),
      true,
      "description-only match (Reconcile ledger) is ranked after title matches and falls past the cap",
    );

    const dashboard = searchWorkspace("dashboard", [p2, p1], tasks, sections);
    assert.equal(dashboard.tasks.length, 1);
    assert.equal(dashboard.tasks[0].project.uuid, "p1");
    assert.equal(dashboard.tasks[0].section?.title, "Phase 1", "section resolved from the project's sections");
    assert.equal(dashboard.projects.length, 0);

    const projectsOnly = searchWorkspace("payroll", [p1, p2], tasks, sections);
    assert.deepEqual(projectsOnly.projects.map((p) => p.uuid), ["p2"]);
    assert.equal(projectsOnly.tasks.length, 0);
    assert.equal(projectsOnly.truncated, false);

    const phase = searchWorkspace("phase", [p1, p2], tasks, sections);
    assert.equal(phase.sections.length, 1);
    assert.equal(phase.sections[0].section.title, "Phase 1");
    assert.equal(phase.sections[0].project.uuid, "p1");
  });
});

describe("dates", () => {
  const now = new Date(2026, 10, 2, 15, 0, 0);
  it("parses ISO dates as local calendar dates", () => {
    const d = parseIsoDate("2026-03-05");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2);
    assert.equal(d.getDate(), 5);
    assert.equal(toIsoDate(d), "2026-03-05");
  });
  it("describes due dates relative to today", () => {
    assert.equal(daysUntil("2026-11-02", now), 0);
    assert.equal(formatDueDate("2026-11-02", now), "Today");
    assert.equal(formatDueDate("2026-11-03", now), "Tomorrow");
    assert.equal(formatDueDate("2026-11-01", now), "Yesterday");
    assert.equal(formatDueDate("2026-11-06", now), "In 4 days");
    assert.equal(formatDueDate("2026-10-29", now), "4 days ago");
    assert.equal(formatDueDate(null, now), "No due date");
    assert.equal(isOverdue("2026-11-01", now), true);
    assert.equal(isOverdue("2026-11-02", now), false);
    assert.equal(isOverdue(null, now), false);
  });
  it("formats relative timestamps", () => {
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    assert.equal(formatRelative(at(0), now), "just now");
    assert.equal(formatRelative(at(5), now), "5m ago");
    assert.equal(formatRelative(at(3 * 60), now), "3h ago");
    assert.equal(formatRelative(at(2 * 24 * 60), now), "2d ago");
  });
});

describe("permissions", () => {
  const owner = user(1);
  const editor = user(2);
  const viewer = user(3);
  const outsider = user(4);
  const admin = user(5, "admin");
  const project = {
    uuid: "p",
    owner: summary(owner),
    members: [
      { uuid: "m1", user: summary(owner), role: "owner", joinedAt: "" },
      { uuid: "m2", user: summary(editor), role: "editor", joinedAt: "" },
      { uuid: "m3", user: summary(viewer), role: "viewer", joinedAt: "" },
    ],
  } as unknown as Project;

  it("derives the member role", () => {
    assert.equal(memberRole(project, owner), "owner");
    assert.equal(memberRole(project, editor), "editor");
    assert.equal(memberRole(project, viewer), "viewer");
    assert.equal(memberRole(project, outsider), null);
    assert.equal(memberRole(null, owner), null);
  });

  it("mirrors the backend rules", () => {
    assert.equal(canEditProject(project, owner), true);
    assert.equal(canEditProject(project, editor), true);
    assert.equal(canEditProject(project, viewer), false);
    assert.equal(canEditProject(project, outsider), false);
    assert.equal(canEditProject(project, admin), true);

    assert.equal(canManageMembers(project, owner), true);
    assert.equal(canManageMembers(project, editor), false);
    assert.equal(canManageMembers(project, admin), true);

    assert.equal(canLeaveProject(project, owner), false);
    assert.equal(canLeaveProject(project, editor), true);
    assert.equal(canLeaveProject(project, viewer), true);
    assert.equal(canLeaveProject(project, outsider), false);
  });
});

describe("routes", () => {
  it("builds paths and encodes tokens", () => {
    assert.equal(routes.project("abc"), "/projects/abc");
    assert.equal(routes.section("a", "b"), "/projects/a/sections/b");
    assert.equal(routes.invitationToken("a/b c"), "/invitations/a%2Fb%20c");
    assert.equal(routes.login(), "/login");
    assert.equal(routes.login("/"), "/login");
    assert.equal(routes.login("/projects?x=1"), "/login?next=%2Fprojects%3Fx%3D1");
  });

  it("only accepts same-origin paths as a post-login destination", () => {
    assert.equal(safeNext("/projects/1"), "/projects/1");
    assert.equal(safeNext("https://evil.example"), "/");
    assert.equal(safeNext("//evil.example"), "/");
    assert.equal(safeNext(null, "/dashboard"), "/dashboard");
    assert.equal(safeNext(""), "/");
  });

  it("measures route depth for the slide direction", () => {
    assert.equal(routeDepth("/"), 0);
    assert.equal(routeDepth("/projects"), 1);
    assert.equal(routeDepth("/projects/a/sections/b"), 4);
  });
});

describe("ApiError", () => {
  it("exposes field errors as a map and a user-safe message", () => {
    const err = new ApiError(422, "validation_failed", "Check the fields.", [
      { field: "email", message: "Invalid." },
      { field: "name", message: "Required." },
    ]);
    assert.deepEqual(err.fieldMap, { email: "Invalid.", name: "Required." });
    assert.equal(ApiError.is(err), true);
    assert.equal(ApiError.is(new Error("x")), false);
    assert.equal(ApiError.message(err), "Check the fields.");
    assert.equal(ApiError.message(new Error("internal detail")), "Something went wrong. Please try again.");
    assert.equal(ApiError.message(undefined, "Custom"), "Custom");
  });
});
