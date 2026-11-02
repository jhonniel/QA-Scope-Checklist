import type {
  ActivityLog,
  AdminAuditEntry,
  AdminErrorLog,
  AdminProject,
  ChecklistSection,
  ExportTemplate,
  Project,
  ProjectInvitation,
  ProjectMember,
  Task,
  TaskCheck,
  TaskComment,
  TaskStatus,
  User,
  UserSummary,
} from "@scope/contracts";
import { toIsoDate } from "@/lib/date";

/**
 * Development fixtures. Dates are relative to "now" so deadlines and activity
 * always look live. Phase 2 replaces this file with database seeders.
 */

const now = new Date();
const daysFromNow = (n: number) => toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const uuid = (group: string, n: number) => `${group}0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users: User[] = [
  { uuid: uuid("a1a1", 1), name: "Maya Santos", email: "maya@infosoft.ph", role: "admin", avatarUrl: null, createdAt: hoursAgo(2000), updatedAt: hoursAgo(10) },
  { uuid: uuid("a1a1", 2), name: "Daniel Reyes", email: "daniel@infosoft.ph", role: "user", avatarUrl: null, createdAt: hoursAgo(1800), updatedAt: hoursAgo(30) },
  { uuid: uuid("a1a1", 3), name: "Priya Nair", email: "priya@infosoft.ph", role: "user", avatarUrl: null, createdAt: hoursAgo(1500), updatedAt: hoursAgo(5) },
  { uuid: uuid("a1a1", 4), name: "Jonas Lim", email: "jonas@infosoft.ph", role: "user", avatarUrl: null, createdAt: hoursAgo(900), updatedAt: hoursAgo(72) },
];

export const currentUser: User = users[1];

const summary = (u: User): UserSummary => ({ uuid: u.uuid, name: u.name, email: u.email, avatarUrl: u.avatarUrl });
const [maya, daniel, priya, jonas] = users.map(summary);

const member = (n: number, user: UserSummary, role: ProjectMember["role"], joinedHoursAgo: number): ProjectMember => ({
  uuid: uuid("b2b2", n),
  user,
  role,
  joinedAt: hoursAgo(joinedHoursAgo),
});

// ---------------------------------------------------------------------------
// Projects (stats are recomputed by the store from tasks)
// ---------------------------------------------------------------------------

const emptyStats = { totalTasks: 0, completedTasks: 0, completionPercent: 0, sectionCount: 0, overdueTasks: 0 };

export const projects: Project[] = [
  {
    uuid: uuid("c3c3", 1),
    name: "Barangay Records Portal",
    description: "Scope and acceptance checklist for the records management portal: data migration, resident lookup, certificate issuance, and audit reporting.",
    owner: daniel,
    status: "active",
    startDate: daysFromNow(-21),
    deadline: daysFromNow(12),
    stats: emptyStats,
    members: [member(1, daniel, "owner", 500), member(2, maya, "editor", 480), member(3, priya, "editor", 300), member(4, jonas, "viewer", 120)],
    createdAt: hoursAgo(504),
    updatedAt: hoursAgo(2),
  },
  {
    uuid: uuid("c3c3", 2),
    name: "Treasury Payment Gateway",
    description: "Integration checklist for LandBank and DragonPay payment channels, reconciliation reports, and cashier workflows.",
    owner: daniel,
    status: "active",
    startDate: daysFromNow(-10),
    deadline: daysFromNow(30),
    stats: emptyStats,
    members: [member(5, daniel, "owner", 240), member(6, priya, "viewer", 200)],
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(6),
  },
  {
    uuid: uuid("c3c3", 3),
    name: "HR Leave Management",
    description: "Shared checklist for leave credits computation, approval routing, and DTR import.",
    owner: priya,
    status: "active",
    startDate: daysFromNow(-40),
    deadline: daysFromNow(-2),
    stats: emptyStats,
    members: [member(7, priya, "owner", 960), member(8, daniel, "editor", 900)],
    createdAt: hoursAgo(960),
    updatedAt: hoursAgo(26),
  },
  {
    uuid: uuid("c3c3", 4),
    name: "Business Permit Renewal 2025",
    description: "Completed scope checklist for the annual renewal cycle, delivered and signed off.",
    owner: daniel,
    status: "completed",
    startDate: daysFromNow(-120),
    deadline: daysFromNow(-60),
    stats: emptyStats,
    members: [member(9, daniel, "owner", 2800), member(10, maya, "viewer", 2700)],
    createdAt: hoursAgo(2880),
    updatedAt: hoursAgo(1400),
  },
];

const [portal, treasury, hr, permits] = projects;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

let sectionCounter = 0;
const section = (project: Project, title: string, description: string | null = null): ChecklistSection => {
  sectionCounter += 1;
  return {
    uuid: uuid("d4d4", sectionCounter),
    projectUuid: project.uuid,
    title,
    description,
    position: 0,
    createdAt: hoursAgo(400),
    updatedAt: hoursAgo(40),
  };
};

export const sections: ChecklistSection[] = [
  section(portal, "Data migration", "Legacy spreadsheets to the normalized resident schema."),
  section(portal, "Resident lookup", null),
  section(portal, "Certificate issuance", "Barangay clearance, indigency, residency."),
  section(portal, "Audit & reporting", null),
  section(treasury, "LandBank integration"),
  section(treasury, "DragonPay integration"),
  section(treasury, "Reconciliation"),
  section(hr, "Leave credits"),
  section(hr, "Approval routing"),
  section(permits, "Renewal workflow"),
  section(permits, "Sign-off"),
].map((s, i, arr) => {
  const siblingsBefore = arr.slice(0, i).filter((x) => x.projectUuid === s.projectUuid).length;
  return { ...s, position: siblingsBefore };
});

const sectionsOf = (project: Project) => sections.filter((s) => s.projectUuid === project.uuid);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

let taskCounter = 0;
interface TaskSeed {
  title: string;
  /** Remarks status. `done` is shorthand for status "done" + both checks. */
  status?: TaskStatus;
  done?: boolean;
  /** Who ticked the Developer / Client boxes (null = unchecked). */
  dev?: UserSummary | null;
  client?: UserSummary | null;
  due?: number | null;
  priority?: Task["priority"];
  assignee?: UserSummary | null;
  description?: string | null;
  comments?: number;
}

const check = (by: UserSummary | null | undefined, hours: number): TaskCheck | null => (by ? { checkedBy: by, checkedAt: hoursAgo(hours) } : null);

const tasksFor = (sec: ChecklistSection, seeds: TaskSeed[]): Task[] =>
  seeds.map((seed, position) => {
    taskCounter += 1;
    const status: TaskStatus = seed.status ?? (seed.done ? "done" : "not_started");
    const done = seed.done ?? (status === "done" || status === "completed");
    const dev = seed.dev === undefined ? (done ? seed.assignee ?? daniel : null) : seed.dev;
    const client = seed.client === undefined ? (done ? maya : null) : seed.client;
    return {
      uuid: uuid("e5e5", taskCounter),
      projectUuid: sec.projectUuid,
      sectionUuid: sec.uuid,
      title: seed.title,
      description: seed.description ?? null,
      status,
      developerCheck: check(dev, 30 + position * 7),
      clientCheck: check(client, 12 + position * 5),
      dueDate: seed.due === undefined || seed.due === null ? null : daysFromNow(seed.due),
      priority: seed.priority ?? "medium",
      assignee: seed.assignee ?? null,
      position,
      commentCount: seed.comments ?? 0,
      createdAt: hoursAgo(300 - position * 3),
      updatedAt: hoursAgo(done ? 12 : 48),
    };
  });

const [pMigration, pLookup, pCerts, pAudit] = sectionsOf(portal);
const [tLandbank, tDragonpay, tRecon] = sectionsOf(treasury);
const [hCredits, hRouting] = sectionsOf(hr);
const [bWorkflow, bSignoff] = sectionsOf(permits);

export const tasks: Task[] = [
  ...tasksFor(pMigration, [
    { title: "Export legacy resident spreadsheets", status: "completed", dev: daniel, client: maya, assignee: daniel, due: -14 },
    { title: "Define field mapping to residents table", done: true, assignee: priya, due: -10, comments: 3, description: "Map every legacy column to the normalized schema. Flag columns that have no destination." },
    { title: "Write migration dry-run script", status: "done_for_production", dev: priya, client: null, assignee: priya, due: -7 },
    { title: "Validate 5% random sample against source", status: "for_qa", dev: priya, client: null, assignee: maya, due: 2, priority: "high", comments: 1, description: "Pick a random 5% sample, compare every field against the source spreadsheet, and record mismatches in the audit sheet." },
    { title: "Sign off migration with Barangay Secretary", status: "for_user_acceptance", dev: daniel, client: null, due: 5, priority: "high" },
  ]),
  ...tasksFor(pLookup, [
    { title: "Search by name with partial match", done: true, assignee: daniel },
    { title: "Search by household number", done: true, assignee: daniel },
    { title: "Debounced autocomplete for large result sets", status: "in_development", assignee: daniel, due: 1, priority: "high", description: "Server-side pagination; never load the full resident list into the browser." },
    { title: "Resident profile summary card", status: "for_revision", dev: priya, client: null, due: 4, assignee: priya },
    { title: "Print-friendly resident record", due: 8 },
  ]),
  ...tasksFor(pCerts, [
    { title: "Barangay clearance template", done: true, assignee: maya },
    { title: "Certificate of indigency template", status: "for_beta_testing", dev: maya, client: null, assignee: maya, due: 3 },
    { title: "Certificate of residency template", status: "in_development", due: 6 },
    { title: "Serial numbering with yearly reset", status: "on_hold", due: 9, priority: "high", comments: 2 },
    { title: "QR verification code on printed certificates", due: 10, description: "QR must encode the certificate public code, never the database primary key." },
  ]),
  ...tasksFor(pAudit, [
    { title: "Activity log for every issuance", done: true, assignee: daniel },
    { title: "Monthly issuance summary report", status: "in_development", due: 11, assignee: jonas },
    { title: "Export audit trail to DOCX", status: "not_applicable", dev: daniel, client: maya, due: 12 },
  ]),

  ...tasksFor(tLandbank, [
    { title: "Request UAT credentials", status: "completed", dev: daniel, client: priya, assignee: daniel, due: -5 },
    { title: "Implement payment reference generation", done: true, assignee: daniel },
    { title: "Handle callback signature verification", status: "for_qa", dev: daniel, client: null, assignee: daniel, due: 3, priority: "high", comments: 4 },
    { title: "Timeout and retry policy", due: 7 },
  ]),
  ...tasksFor(tDragonpay, [
    { title: "Sandbox merchant setup", done: true, assignee: daniel },
    { title: "Channel selection UI", status: "in_development", due: 6, assignee: priya },
    { title: "Postback handling", due: 9, priority: "high" },
  ]),
  ...tasksFor(tRecon, [
    { title: "Daily collection report", due: 14 },
    { title: "Mismatch flagging for cashier review", due: 18 },
    { title: "Reconciliation export template", status: "on_hold", due: 21 },
  ]),

  ...tasksFor(hCredits, [
    { title: "Monthly accrual computation", done: true, assignee: priya },
    { title: "Carry-over rules for year end", done: true, assignee: priya },
    { title: "Forfeiture of excess credits", done: true, assignee: daniel, comments: 2 },
    { title: "Credit adjustment with audit reason", status: "for_revision", dev: daniel, client: null, assignee: daniel, due: -2, priority: "high" },
  ]),
  ...tasksFor(hRouting, [
    { title: "Supervisor approval step", done: true, assignee: priya },
    { title: "HR final approval step", done: true, assignee: priya },
    { title: "Email notification on status change", status: "for_user_acceptance", dev: daniel, client: null, due: -1, assignee: daniel },
    { title: "DTR import from biometrics CSV", due: 4 },
  ]),

  ...tasksFor(bWorkflow, [
    { title: "Renewal application form", status: "completed", assignee: daniel },
    { title: "Assessment of fees", status: "completed", assignee: daniel },
    { title: "Payment confirmation", status: "completed", assignee: daniel },
    { title: "Permit printing", status: "completed", assignee: maya },
  ]),
  ...tasksFor(bSignoff, [
    { title: "UAT sign-off by BPLO", status: "completed", assignee: daniel },
    { title: "Final DOCX scope document delivered", status: "completed", assignee: daniel },
  ]),
];

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

const taskByTitle = (title: string) => tasks.find((t) => t.title === title)!;

export const comments: TaskComment[] = [
  { uuid: uuid("f6f6", 1), taskUuid: taskByTitle("Define field mapping to residents table").uuid, author: priya, body: "Mapping sheet is in the shared drive. Three legacy columns have no destination — flagged in red.", createdAt: hoursAgo(70), updatedAt: hoursAgo(70) },
  { uuid: uuid("f6f6", 2), taskUuid: taskByTitle("Define field mapping to residents table").uuid, author: daniel, body: "Let's drop the two free-text columns and keep 'remarks' as a nullable text field.", createdAt: hoursAgo(66), updatedAt: hoursAgo(66) },
  { uuid: uuid("f6f6", 3), taskUuid: taskByTitle("Define field mapping to residents table").uuid, author: maya, body: "Agreed. Please note it in the migration notes for the audit.", createdAt: hoursAgo(60), updatedAt: hoursAgo(60) },
  { uuid: uuid("f6f6", 4), taskUuid: taskByTitle("Validate 5% random sample against source").uuid, author: maya, body: "I'll start on this tomorrow morning once the dry-run finishes.", createdAt: hoursAgo(20), updatedAt: hoursAgo(20) },
  { uuid: uuid("f6f6", 5), taskUuid: taskByTitle("Handle callback signature verification").uuid, author: daniel, body: "LandBank uses HMAC-SHA256 over the raw body. Their sample code strips whitespace first — confirming whether we must do the same.", createdAt: hoursAgo(30), updatedAt: hoursAgo(30) },
];

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

let activityCounter = 0;
const activity = (project: Project, actor: UserSummary, action: ActivityLog["action"], subject: string, hours: number, meta: ActivityLog["meta"] = null): ActivityLog => {
  activityCounter += 1;
  return { uuid: uuid("a7a7", activityCounter), projectUuid: project.uuid, actor, action, subject, meta, createdAt: hoursAgo(hours) };
};

export const activities: ActivityLog[] = [
  activity(portal, priya, "task.status_changed", "Write migration dry-run script", 2, { from: "for_qa", to: "done_for_production" }),
  activity(portal, priya, "task.checked", "Write migration dry-run script", 3, { side: "developer" }),
  activity(portal, maya, "comment.added", "Validate 5% random sample against source", 20),
  activity(treasury, daniel, "comment.added", "Handle callback signature verification", 30),
  activity(portal, daniel, "task.created", "Export audit trail to DOCX", 31),
  activity(hr, maya, "task.checked", "Forfeiture of excess credits", 40, { side: "client" }),
  activity(portal, daniel, "member.joined", "Jonas Lim joined as viewer", 120),
  activity(treasury, daniel, "task.status_changed", "Implement payment reference generation", 140, { from: "for_user_acceptance", to: "done" }),
  activity(portal, daniel, "export.generated", "Scope checklist v3.docx", 170),
  activity(portal, priya, "task.assigned", "Resident profile summary card → Priya Nair", 190),
  activity(treasury, daniel, "project.created", "Treasury Payment Gateway", 240),
  activity(hr, priya, "task.status_changed", "Credit adjustment with audit reason", 300, { from: "for_qa", to: "for_revision" }),
  activity(portal, maya, "section.created", "Audit & reporting", 380),
];

// ---------------------------------------------------------------------------
// Export templates (reference data; the layout definition lives server-side)
// ---------------------------------------------------------------------------

export const exportTemplates: ExportTemplate[] = [
  { uuid: uuid("7e7e", 1), name: "Default", description: "Checked by (Developer | Client) · Item Description · Remarks", isDefault: true, createdAt: hoursAgo(2000), updatedAt: hoursAgo(2000) },
];

// ---------------------------------------------------------------------------
// Administration: a soft-deleted project and the admin audit trail
// ---------------------------------------------------------------------------

export const deletedProjects: AdminProject[] = [
  {
    uuid: uuid("c3c3", 5),
    name: "Legacy Intranet Migration",
    description: "Abandoned scope for moving the intranet wiki; superseded by the records portal.",
    owner: priya,
    status: "archived",
    startDate: daysFromNow(-200),
    deadline: daysFromNow(-120),
    stats: { totalTasks: 0, completedTasks: 0, completionPercent: 0, sectionCount: 1, overdueTasks: 0 },
    members: [member(11, priya, "owner", 4800)],
    createdAt: hoursAgo(4800),
    updatedAt: hoursAgo(700),
    deletedAt: hoursAgo(700),
  },
];

export const adminAudit: AdminAuditEntry[] = [
  { uuid: uuid("a8a8", 2), actor: maya, action: "user.password_reset_sent", targetType: "user", targetUuid: jonas.uuid, subject: jonas.name, meta: null, createdAt: hoursAgo(96) },
  { uuid: uuid("a8a8", 1), actor: maya, action: "user.role_changed", targetType: "user", targetUuid: maya.uuid, subject: maya.name, meta: { from: "user", to: "admin" }, createdAt: hoursAgo(1990) },
];

/** Sample failures so the Errors tab has something to show in mock mode. */
export const errorLogs: AdminErrorLog[] = [
  {
    uuid: uuid("e9e9", 2),
    source: "api",
    status: 500,
    code: "server_error",
    message: "SQLITE_BUSY: database is locked",
    stack: "Error: SQLITE_BUSY: database is locked\n    at SqliteDatabase.execute (db/sqlite.ts:52:13)\n    at TaskRepository.update (domain/repositories/TaskRepository.ts:118:5)",
    method: "PATCH",
    path: "/api/tasks/e5e50000-0000-4000-8000-000000000032",
    actor: daniel,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
    context: { name: "Error" },
    createdAt: hoursAgo(5),
  },
  {
    uuid: uuid("e9e9", 1),
    source: "web",
    status: null,
    code: "TypeError",
    message: "Cannot read properties of undefined (reading 'uuid')",
    stack: "TypeError: Cannot read properties of undefined (reading 'uuid')\n    at SectionPage (modules/checklist/SectionPage.tsx:74:31)",
    method: null,
    path: "/projects/c3c30000-0000-4000-8000-000000000003/sections/missing",
    actor: priya,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1",
    context: { kind: "route" },
    createdAt: hoursAgo(50),
  },
];

// ---------------------------------------------------------------------------
// Invitations (append-only; closed ones keep their status for the history)
// ---------------------------------------------------------------------------

export const invitations: ProjectInvitation[] = [
  { uuid: uuid("b2b2", 101), projectUuid: treasury.uuid, projectName: treasury.name, email: "jonas@infosoft.ph", role: "editor", status: "pending", invitedBy: daniel, createdAt: hoursAgo(6), respondedAt: null },
  { uuid: uuid("b2b2", 102), projectUuid: portal.uuid, projectName: portal.name, email: "secretary@barangay.gov.ph", role: "viewer", status: "pending", invitedBy: daniel, createdAt: hoursAgo(30), respondedAt: null },
  { uuid: uuid("b2b2", 103), projectUuid: hr.uuid, projectName: hr.name, email: "auditor@infosoft.ph", role: "viewer", status: "revoked", invitedBy: priya, createdAt: hoursAgo(300), respondedAt: hoursAgo(276) },
];
