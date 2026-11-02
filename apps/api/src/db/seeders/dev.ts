import type { ActivityAction, ProjectMemberRole, ProjectStatus, TaskPriority, TaskStatus } from "@scope/contracts";
import type { Database } from "../database.ts";
import { toSqlDateTime } from "../database.ts";
import { hashPassword, hashToken } from "../../domain/services/password.ts";
import { repositories } from "../../domain/repositories/index.ts";

/**
 * Development fixtures — the same people, projects and tasks as the Phase 1
 * mock data so the UI looks identical when switched to the real API.
 * Every account's password is "password". Never run against production.
 */

const now = new Date();
const dayOffset = (n: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hoursAgo = (h: number) => toSqlDateTime(new Date(now.getTime() - h * 3_600_000));
const uuid = (group: string, n: number) => `${group}0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface SeedUser {
  key: "maya" | "daniel" | "priya" | "jonas";
  name: string;
  email: string;
  role: "admin" | "user";
}

const USERS: SeedUser[] = [
  { key: "maya", name: "Maya Santos", email: "maya@infosoft.ph", role: "admin" },
  { key: "daniel", name: "Daniel Reyes", email: "daniel@infosoft.ph", role: "user" },
  { key: "priya", name: "Priya Nair", email: "priya@infosoft.ph", role: "user" },
  { key: "jonas", name: "Jonas Lim", email: "jonas@infosoft.ph", role: "user" },
];

type UserKey = SeedUser["key"];

interface TaskSeed {
  title: string;
  status?: TaskStatus;
  done?: boolean;
  dev?: UserKey | null;
  client?: UserKey | null;
  due?: number | null;
  priority?: TaskPriority;
  assignee?: UserKey | null;
  description?: string | null;
}

interface SectionSeed {
  title: string;
  description?: string | null;
  tasks: TaskSeed[];
}

interface ProjectSeed {
  n: number;
  name: string;
  description: string;
  owner: UserKey;
  status: ProjectStatus;
  start: number;
  deadline: number;
  createdHoursAgo: number;
  members: [UserKey, ProjectMemberRole, number][];
  sections: SectionSeed[];
}

const PROJECTS: ProjectSeed[] = [
  {
    n: 1,
    name: "Barangay Records Portal",
    description: "Scope and acceptance checklist for the records management portal: data migration, resident lookup, certificate issuance, and audit reporting.",
    owner: "daniel",
    status: "active",
    start: -21,
    deadline: 12,
    createdHoursAgo: 504,
    members: [
      ["daniel", "owner", 500],
      ["maya", "editor", 480],
      ["priya", "editor", 300],
      ["jonas", "viewer", 120],
    ],
    sections: [
      {
        title: "Data migration",
        description: "Legacy spreadsheets to the normalized resident schema.",
        tasks: [
          { title: "Export legacy resident spreadsheets", status: "completed", dev: "daniel", client: "maya", assignee: "daniel", due: -14 },
          { title: "Define field mapping to residents table", done: true, assignee: "priya", due: -10, description: "Map every legacy column to the normalized schema. Flag columns that have no destination." },
          { title: "Write migration dry-run script", status: "done_for_production", dev: "priya", client: null, assignee: "priya", due: -7 },
          {
            title: "Validate 5% random sample against source",
            status: "for_qa",
            dev: "priya",
            client: null,
            assignee: "maya",
            due: 2,
            priority: "high",
            description: "Pick a random 5% sample, compare every field against the source spreadsheet, and record mismatches in the audit sheet.",
          },
          { title: "Sign off migration with Barangay Secretary", status: "for_user_acceptance", dev: "daniel", client: null, due: 5, priority: "high" },
        ],
      },
      {
        title: "Resident lookup",
        tasks: [
          { title: "Search by name with partial match", done: true, assignee: "daniel" },
          { title: "Search by household number", done: true, assignee: "daniel" },
          { title: "Debounced autocomplete for large result sets", status: "in_development", assignee: "daniel", due: 1, priority: "high", description: "Server-side pagination; never load the full resident list into the browser." },
          { title: "Resident profile summary card", status: "for_revision", dev: "priya", client: null, due: 4, assignee: "priya" },
          { title: "Print-friendly resident record", due: 8 },
        ],
      },
      {
        title: "Certificate issuance",
        description: "Barangay clearance, indigency, residency.",
        tasks: [
          { title: "Barangay clearance template", done: true, assignee: "maya" },
          { title: "Certificate of indigency template", status: "for_beta_testing", dev: "maya", client: null, assignee: "maya", due: 3 },
          { title: "Certificate of residency template", status: "in_development", due: 6 },
          { title: "Serial numbering with yearly reset", status: "on_hold", due: 9, priority: "high" },
          { title: "QR verification code on printed certificates", due: 10, description: "QR must encode the certificate public code, never the database primary key." },
        ],
      },
      {
        title: "Audit & reporting",
        tasks: [
          { title: "Activity log for every issuance", done: true, assignee: "daniel" },
          { title: "Monthly issuance summary report", status: "in_development", due: 11, assignee: "jonas" },
          { title: "Export audit trail to DOCX", status: "not_applicable", dev: "daniel", client: "maya", due: 12 },
        ],
      },
    ],
  },
  {
    n: 2,
    name: "Treasury Payment Gateway",
    description: "Integration checklist for LandBank and DragonPay payment channels, reconciliation reports, and cashier workflows.",
    owner: "daniel",
    status: "active",
    start: -10,
    deadline: 30,
    createdHoursAgo: 240,
    members: [
      ["daniel", "owner", 240],
      ["priya", "viewer", 200],
    ],
    sections: [
      {
        title: "LandBank integration",
        tasks: [
          { title: "Request UAT credentials", status: "completed", dev: "daniel", client: "priya", assignee: "daniel", due: -5 },
          { title: "Implement payment reference generation", done: true, assignee: "daniel" },
          { title: "Handle callback signature verification", status: "for_qa", dev: "daniel", client: null, assignee: "daniel", due: 3, priority: "high" },
          { title: "Timeout and retry policy", due: 7 },
        ],
      },
      {
        title: "DragonPay integration",
        tasks: [
          { title: "Sandbox merchant setup", done: true, assignee: "daniel" },
          { title: "Channel selection UI", status: "in_development", due: 6, assignee: "priya" },
          { title: "Postback handling", due: 9, priority: "high" },
        ],
      },
      {
        title: "Reconciliation",
        tasks: [
          { title: "Daily collection report", due: 14 },
          { title: "Mismatch flagging for cashier review", due: 18 },
          { title: "Reconciliation export template", status: "on_hold", due: 21 },
        ],
      },
    ],
  },
  {
    n: 3,
    name: "HR Leave Management",
    description: "Shared checklist for leave credits computation, approval routing, and DTR import.",
    owner: "priya",
    status: "active",
    start: -40,
    deadline: -2,
    createdHoursAgo: 960,
    members: [
      ["priya", "owner", 960],
      ["daniel", "editor", 900],
    ],
    sections: [
      {
        title: "Leave credits",
        tasks: [
          { title: "Monthly accrual computation", done: true, assignee: "priya" },
          { title: "Carry-over rules for year end", done: true, assignee: "priya" },
          { title: "Forfeiture of excess credits", done: true, assignee: "daniel" },
          { title: "Credit adjustment with audit reason", status: "for_revision", dev: "daniel", client: null, assignee: "daniel", due: -2, priority: "high" },
        ],
      },
      {
        title: "Approval routing",
        tasks: [
          { title: "Supervisor approval step", done: true, assignee: "priya" },
          { title: "HR final approval step", done: true, assignee: "priya" },
          { title: "Email notification on status change", status: "for_user_acceptance", dev: "daniel", client: null, due: -1, assignee: "daniel" },
          { title: "DTR import from biometrics CSV", due: 4 },
        ],
      },
    ],
  },
  {
    n: 4,
    name: "Business Permit Renewal 2025",
    description: "Completed scope checklist for the annual renewal cycle, delivered and signed off.",
    owner: "daniel",
    status: "completed",
    start: -120,
    deadline: -60,
    createdHoursAgo: 2880,
    members: [
      ["daniel", "owner", 2800],
      ["maya", "viewer", 2700],
    ],
    sections: [
      {
        title: "Renewal workflow",
        tasks: [
          { title: "Renewal application form", status: "completed", assignee: "daniel" },
          { title: "Assessment of fees", status: "completed", assignee: "daniel" },
          { title: "Payment confirmation", status: "completed", assignee: "daniel" },
          { title: "Permit printing", status: "completed", assignee: "maya" },
        ],
      },
      {
        title: "Sign-off",
        tasks: [
          { title: "UAT sign-off by BPLO", status: "completed", assignee: "daniel" },
          { title: "Final DOCX scope document delivered", status: "completed", assignee: "daniel" },
        ],
      },
    ],
  },
];

interface CommentSeed {
  task: string;
  author: UserKey;
  body: string;
  hoursAgo: number;
}

const COMMENTS: CommentSeed[] = [
  { task: "Define field mapping to residents table", author: "priya", body: "Mapping sheet is in the shared drive. Three legacy columns have no destination — flagged in red.", hoursAgo: 70 },
  { task: "Define field mapping to residents table", author: "daniel", body: "Let's drop the two free-text columns and keep 'remarks' as a nullable text field.", hoursAgo: 66 },
  { task: "Define field mapping to residents table", author: "maya", body: "Agreed. Please note it in the migration notes for the audit.", hoursAgo: 60 },
  { task: "Validate 5% random sample against source", author: "maya", body: "I'll start on this tomorrow morning once the dry-run finishes.", hoursAgo: 20 },
  { task: "Handle callback signature verification", author: "daniel", body: "LandBank uses HMAC-SHA256 over the raw body. Their sample code strips whitespace first — confirming whether we must do the same.", hoursAgo: 30 },
];

interface ActivitySeed {
  project: number;
  actor: UserKey;
  action: ActivityAction;
  subject: string;
  hoursAgo: number;
  meta?: Record<string, unknown>;
}

const ACTIVITY: ActivitySeed[] = [
  { project: 1, actor: "priya", action: "task.status_changed", subject: "Write migration dry-run script", hoursAgo: 2, meta: { from: "for_qa", to: "done_for_production" } },
  { project: 1, actor: "priya", action: "task.checked", subject: "Write migration dry-run script", hoursAgo: 3, meta: { side: "developer" } },
  { project: 1, actor: "maya", action: "comment.added", subject: "Validate 5% random sample against source", hoursAgo: 20 },
  { project: 2, actor: "daniel", action: "comment.added", subject: "Handle callback signature verification", hoursAgo: 30 },
  { project: 1, actor: "daniel", action: "task.created", subject: "Export audit trail to DOCX", hoursAgo: 31 },
  { project: 3, actor: "maya", action: "task.checked", subject: "Forfeiture of excess credits", hoursAgo: 40, meta: { side: "client" } },
  { project: 1, actor: "daniel", action: "member.joined", subject: "Jonas Lim joined as viewer", hoursAgo: 120 },
  { project: 2, actor: "daniel", action: "task.status_changed", subject: "Implement payment reference generation", hoursAgo: 140, meta: { from: "for_user_acceptance", to: "done" } },
  { project: 1, actor: "daniel", action: "export.generated", subject: "Scope checklist v3.docx", hoursAgo: 170 },
  { project: 1, actor: "priya", action: "task.assigned", subject: "Resident profile summary card → Priya Nair", hoursAgo: 190 },
  { project: 2, actor: "daniel", action: "project.created", subject: "Treasury Payment Gateway", hoursAgo: 240 },
  { project: 3, actor: "priya", action: "task.status_changed", subject: "Credit adjustment with audit reason", hoursAgo: 300, meta: { from: "for_qa", to: "for_revision" } },
  { project: 1, actor: "maya", action: "section.created", subject: "Audit & reporting", hoursAgo: 380 },
];

export async function seedDevelopment(db: Database, log: (msg: string) => void = () => {}): Promise<void> {
  const repos = repositories(db);
  if ((await repos.users.count()) > 0) {
    log("Database already contains users — skipping seed. Run db:fresh to reset.");
    return;
  }

  const passwordHash = await hashPassword("password");

  await db.transaction(async (tx) => {
    const r = repositories(tx);
    const userIds = {} as Record<UserKey, number>;
    for (let i = 0; i < USERS.length; i += 1) {
      const u = USERS[i];
      const row = await r.users.create({ name: u.name, email: u.email, passwordHash, role: u.role, uuid: uuid("a1a1", i + 1), createdAt: hoursAgo(2000 - i * 300) });
      userIds[u.key] = row.id;
    }
    log(`Users: ${USERS.length} (password: "password")`);

    const taskIdByTitle = new Map<string, number>();
    const projectIdByN = new Map<number, number>();
    let sectionCounter = 0;
    let taskCounter = 0;

    for (const p of PROJECTS) {
      const project = await r.projects.create({
        ownerId: userIds[p.owner],
        name: p.name,
        description: p.description,
        status: p.status,
        startDate: dayOffset(p.start),
        deadline: dayOffset(p.deadline),
        uuid: uuid("c3c3", p.n),
        createdAt: hoursAgo(p.createdHoursAgo),
      });
      projectIdByN.set(p.n, project.id);
      for (const [key, role, joinedHoursAgo] of p.members) await r.projects.addMember(project.id, userIds[key], role, hoursAgo(joinedHoursAgo));

      for (let si = 0; si < p.sections.length; si += 1) {
        const s = p.sections[si];
        sectionCounter += 1;
        const section = await r.sections.create({ projectId: project.id, title: s.title, description: s.description ?? null, position: si, uuid: uuid("d4d4", sectionCounter), createdAt: hoursAgo(400) });

        for (let ti = 0; ti < s.tasks.length; ti += 1) {
          const t = s.tasks[ti];
          taskCounter += 1;
          const status: TaskStatus = t.status ?? (t.done ? "done" : "not_started");
          const done = t.done ?? (status === "done" || status === "completed");
          const dev = t.dev === undefined ? (done ? t.assignee ?? "daniel" : null) : t.dev;
          const client = t.client === undefined ? (done ? "maya" : null) : t.client;
          const task = await r.tasks.create({
            projectId: project.id,
            sectionId: section.id,
            title: t.title,
            description: t.description ?? null,
            status,
            dueDate: t.due === undefined || t.due === null ? null : dayOffset(t.due),
            priority: t.priority ?? "medium",
            assigneeId: t.assignee ? userIds[t.assignee] : null,
            position: ti,
            uuid: uuid("e5e5", taskCounter),
            createdAt: hoursAgo(300 - ti * 3),
            developerCheck: dev ? { userId: userIds[dev], at: hoursAgo(30 + ti * 7) } : null,
            clientCheck: client ? { userId: userIds[client], at: hoursAgo(12 + ti * 5) } : null,
          });
          taskIdByTitle.set(t.title, task.id);
        }
      }
    }
    log(`Projects: ${PROJECTS.length}, sections: ${sectionCounter}, tasks: ${taskCounter}`);

    for (let i = 0; i < COMMENTS.length; i += 1) {
      const c = COMMENTS[i];
      await r.comments.create({ taskId: taskIdByTitle.get(c.task)!, authorId: userIds[c.author], body: c.body, uuid: uuid("f6f6", i + 1), createdAt: hoursAgo(c.hoursAgo) });
    }
    log(`Comments: ${COMMENTS.length}`);

    for (const a of ACTIVITY) {
      await r.activity.record({ projectId: projectIdByN.get(a.project)!, actorId: userIds[a.actor], action: a.action, subject: a.subject, meta: a.meta ?? null, createdAt: hoursAgo(a.hoursAgo) });
    }
    log(`Activity entries: ${ACTIVITY.length}`);

    // Invitations: one for a registered user (shows up on Jonas's dashboard), one for an outside address, one already revoked.
    const invitations: { n: number; email: string; role: "editor" | "viewer"; by: UserKey; hoursAgo: number; status?: "revoked" }[] = [
      { n: 2, email: "jonas@infosoft.ph", role: "editor", by: "daniel", hoursAgo: 6 },
      { n: 1, email: "secretary@barangay.gov.ph", role: "viewer", by: "daniel", hoursAgo: 30 },
      { n: 3, email: "auditor@infosoft.ph", role: "viewer", by: "priya", hoursAgo: 300, status: "revoked" },
    ];
    for (let i = 0; i < invitations.length; i += 1) {
      const inv = invitations[i];
      const row = await r.invitations.create({ projectId: projectIdByN.get(inv.n)!, email: inv.email, role: inv.role, invitedBy: userIds[inv.by], tokenHash: hashToken(`seed-invitation-token-${i + 1}`), uuid: uuid("b2b2", i + 1), createdAt: hoursAgo(inv.hoursAgo) });
      await r.activity.record({ projectId: projectIdByN.get(inv.n)!, actorId: userIds[inv.by], action: "member.invited", subject: inv.email, meta: { role: inv.role }, createdAt: hoursAgo(inv.hoursAgo) });
      if (inv.status === "revoked") {
        await r.invitations.setStatus(row.id, "revoked");
        await r.activity.record({ projectId: projectIdByN.get(inv.n)!, actorId: userIds[inv.by], action: "member.invitation_revoked", subject: inv.email, createdAt: hoursAgo(inv.hoursAgo - 24) });
      }
    }
    log(`Invitations: ${invitations.length}`);

    // A soft-deleted project so the admin registry has something to restore.
    const scrapped = await r.projects.create({
      ownerId: userIds.priya,
      name: "Legacy Intranet Migration",
      description: "Abandoned scope for moving the intranet wiki; superseded by the records portal.",
      status: "archived",
      startDate: dayOffset(-200),
      deadline: dayOffset(-120),
      uuid: uuid("c3c3", 5),
      createdAt: hoursAgo(4800),
    });
    await r.projects.addMember(scrapped.id, userIds.priya, "owner", hoursAgo(4800));
    await r.sections.create({ projectId: scrapped.id, title: "General", description: null, position: 0, uuid: uuid("d4d4", sectionCounter + 1), createdAt: hoursAgo(4800) });
    await r.activity.record({ projectId: scrapped.id, actorId: userIds.priya, action: "project.created", subject: scrapped.name, createdAt: hoursAgo(4800) });
    await r.activity.record({ projectId: scrapped.id, actorId: userIds.priya, action: "project.deleted", subject: scrapped.name, createdAt: hoursAgo(700) });
    await r.projects.softDelete(scrapped.id);

    await r.adminAudit.record({ actorId: userIds.maya, action: "user.role_changed", targetType: "user", targetUuid: uuid("a1a1", 1), subject: "Maya Santos", meta: { from: "user", to: "admin" }, createdAt: hoursAgo(1990) });
    await r.adminAudit.record({ actorId: userIds.maya, action: "user.password_reset_sent", targetType: "user", targetUuid: uuid("a1a1", 4), subject: "Jonas Lim", createdAt: hoursAgo(96) });
    log("Admin: 1 deleted project, 2 audit entries");

    await tx.execute("INSERT INTO export_templates (uuid, name, description, is_default, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      uuid("7e7e", 1),
      "Default",
      "Checked by (Developer | Client) · Item Description · Remarks",
      true,
      // Partial definition — everything not listed falls back to DEFAULT_TEMPLATE_DEFINITION (domain/export/template.ts).
      JSON.stringify({ layout: "checked-by-table", page: { size: "A4", orientation: "portrait", marginPt: 54 }, colors: { headerFill: "8EA9DB" } }),
      hoursAgo(2000),
      hoursAgo(2000),
    ]);
  });
}
