import {
  PRODUCTIVITY_WEIGHTS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  defaultPhaseColor,
  revisionAsOf,
  SECTION_LINK_TITLE_MAX_LENGTH,
  SECTION_NOTE_MAX_LENGTH,
  SECTION_TITLE_MAX_LENGTH,
  normalizeHttpUrl,
  productivityBucket,
  productivityScore,
  type ActivityAction,
  type ActivityLog,
  type ActivityType,
  type CreateSectionReferenceInput,
  type AdminAuditEntry,
  type AdminErrorLog,
  type AdminProductivityEntry,
  type ProductivityBucket,
  type AdminProject,
  type AdminUser,
  type ChecklistSection,
  type Phase,
  type Project,
  type ProjectInvitation,
  type SectionReference,
  type Task,
  type TaskComment,
  type TaskStatus,
  type User,
  type UserSummary,
  type Uuid,
} from "@scope/contracts";
import type { ScopeApi } from "@/services/api/types";
import { ApiError } from "@/services/api/ApiError";
import { computeStats } from "@/lib/stats";
import { isResolved } from "@/lib/taskStatus";
import { formatLongDate } from "@/lib/date";
import * as seed from "./data";

/**
 * In-memory implementation of the API contract. It behaves like a remote
 * service (async, returns copies) so components never depend on synchronous
 * access and Phase 2 can swap in the HTTP client without UI changes.
 */

const LATENCY_MS = 220;
const wait = (ms = LATENCY_MS) => new Promise<void>((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const newUuid = (): Uuid =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

/** Every seeded account signs in with this password in mock mode. */
const MOCK_PASSWORD = "password";

// Mutable working copies so interactions persist for the session.
const db = {
  users: clone(seed.users),
  currentUser: clone(seed.currentUser) as User | null,
  projects: clone(seed.projects),
  sections: clone(seed.sections),
  phases: clone(seed.phases),
  tasks: clone(seed.tasks),
  comments: clone(seed.comments),
  activities: clone(seed.activities),
  invitations: clone(seed.invitations),
  // Administration: soft-deleted projects, disabled accounts and the audit trail.
  deletedProjects: clone(seed.deletedProjects),
  disabledUsers: new Set<Uuid>(),
  pendingUsers: new Set<Uuid>(),
  passwords: new Map<Uuid, string>(),
  adminAudit: clone(seed.adminAudit),
  errorLogs: clone(seed.errorLogs),
};

/** Mirrors `ACTIVITY_TYPE_ACTIONS` on the server. */
const ACTIVITY_TYPE_ACTIONS: Record<Exclude<ActivityType, "all">, readonly ActivityAction[]> = {
  tasks: ["task.created", "task.updated", "task.status_changed", "task.deleted", "task.assigned"],
  checks: ["task.checked", "task.unchecked"],
  comments: ["comment.added", "section.note_added", "section.link_added", "section.reference_deleted"],
  members: ["member.invited", "member.joined", "member.removed", "member.left", "member.role_changed", "member.invitation_declined", "member.invitation_revoked", "project.ownership_transferred"],
  project: ["project.created", "project.updated", "project.status_changed", "project.deleted", "project.restored", "section.created", "section.updated", "section.deleted", "section.completed", "phase.created", "phase.updated", "phase.deleted", "export.generated"],
};

const paginate = <T>(items: T[], page = 1, perPage = 25) => {
  const p = Math.max(1, page);
  const pp = Math.max(1, Math.min(100, perPage));
  return { items: clone(items.slice((p - 1) * pp, p * pp)), page: p, perPage: pp, total: items.length, totalPages: Math.max(1, Math.ceil(items.length / pp)) };
};

function requireAdmin(): User {
  const me = requireUser();
  if (me.role !== "admin") throw new ApiError(403, "forbidden", "Administrator access is required.");
  return me;
}

function audit(action: AdminAuditEntry["action"], targetType: AdminAuditEntry["targetType"], targetUuid: Uuid, subject: string, meta: AdminAuditEntry["meta"] = null) {
  db.adminAudit.unshift({ uuid: newUuid(), actor: actor(), action, targetType, targetUuid, subject, meta, createdAt: nowIso() });
}

function toAdminUser(u: User): AdminUser {
  return {
    ...u,
    approvedAt: db.pendingUsers.has(u.uuid) ? null : u.createdAt,
    disabledAt: db.disabledUsers.has(u.uuid) ? nowIso() : null,
    lastSeenAt: u.uuid === db.currentUser?.uuid ? nowIso() : u.updatedAt,
    ownedProjects: db.projects.filter((p) => p.owner.uuid === u.uuid).length,
    memberships: db.projects.filter((p) => p.members.some((m) => m.user.uuid === u.uuid)).length,
  };
}

function requireDirectoryUser(uuid: Uuid): User {
  const user = db.users.find((u) => u.uuid === uuid);
  if (!user) throw new ApiError(404, "not_found", "User was not found.");
  return user;
}

const activeAdmins = () => db.users.filter((u) => u.role === "admin" && !db.disabledUsers.has(u.uuid) && !db.pendingUsers.has(u.uuid)).length;

const validationError = (field: string, message: string) => new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field, message }]);

function requireProject(uuid: Uuid): Project {
  const project = db.projects.find((p) => p.uuid === uuid);
  if (!project) throw new ApiError(404, "not_found", "Project was not found.");
  return project;
}

function requireManage(project: Project): void {
  const me = requireUser();
  const role = project.members.find((m) => m.user.uuid === me.uuid)?.role;
  if (me.role !== "admin" && role !== "owner") throw new ApiError(403, "forbidden", "Only the project owner can manage members.");
}

function requireActivityOwner(project: Project): void {
  const me = requireUser();
  if (project.owner.uuid === me.uuid) return;
  const isMember = project.members.some((m) => m.user.uuid === me.uuid);
  if (!isMember && me.role !== "admin") throw new ApiError(404, "not_found", "Project was not found.");
  throw new ApiError(403, "forbidden", "Only the project owner can view the activity log.");
}

function requireTask(uuid: Uuid): Task {
  const task = db.tasks.find((t) => t.uuid === uuid);
  if (!task) throw new Error(`Task ${uuid} not found`);
  return task;
}

function requireSection(uuid: Uuid): ChecklistSection {
  const section = db.sections.find((s) => s.uuid === uuid);
  if (!section) throw new ApiError(404, "not_found", "Scope was not found.");
  return section;
}

function requireProjectMember(project: Project): User {
  const me = requireUser();
  if (me.role === "admin") return me;
  if (!project.members.some((m) => m.user.uuid === me.uuid)) throw new ApiError(404, "not_found", "Project was not found.");
  return me;
}

function requireEditableProject(project: Project): void {
  const me = requireProjectMember(project);
  if (me.role === "admin") return;
  const role = project.members.find((m) => m.user.uuid === me.uuid)?.role;
  if (role === "viewer") throw new ApiError(403, "forbidden", "Viewers cannot change this project.");
}

function requireUser(): User {
  if (!db.currentUser) throw new ApiError(401, "unauthenticated", "Please sign in to continue.");
  return db.currentUser;
}

/** The signed-in user as embedded in other resources. */
function buildSectionReference(sectionUuid: Uuid, input: CreateSectionReferenceInput, fieldPrefix = ""): SectionReference {
  const field = (name: string) => (fieldPrefix ? `${fieldPrefix}.${name}` : name);
  const body = input.body.trim();
  if (!body) throw validationError(field("body"), "Write a note or enter a link.");
  if (body.length > SECTION_NOTE_MAX_LENGTH) throw validationError(field("body"), `Use at most ${SECTION_NOTE_MAX_LENGTH} characters.`);
  const title = input.title?.trim() || null;
  if (title && title.length > SECTION_LINK_TITLE_MAX_LENGTH) throw validationError(field("title"), `Use at most ${SECTION_LINK_TITLE_MAX_LENGTH} characters.`);
  if (input.kind !== "note" && input.kind !== "link") throw validationError(field("kind"), "Choose a note or a link.");
  const resolvedBody = input.kind === "link" ? normalizeHttpUrl(body) : body;
  if (input.kind === "link" && !resolvedBody) throw validationError(field("body"), "Enter a valid http or https link.");
  const now = nowIso();
  return {
    uuid: newUuid(),
    sectionUuid,
    kind: input.kind,
    body: resolvedBody!,
    title: input.kind === "link" ? title : null,
    author: actor(),
    createdAt: now,
    updatedAt: now,
  };
}

function actor(): UserSummary {
  const u = requireUser();
  return { uuid: u.uuid, name: u.name, email: u.email, avatarUrl: u.avatarUrl };
}

/** Append-only activity log, exactly as the backend will write it. */
function log(projectUuid: Uuid, action: ActivityLog["action"], subject: string, meta: ActivityLog["meta"] = null) {
  db.activities.unshift({ uuid: newUuid(), projectUuid, actor: actor(), action, subject, meta, createdAt: nowIso() });
}

/**
 * Mirror of the server's completion stamp: a section that just reached 100%
 * gets `completedAt = now` (and a `section.completed` entry), one that fell
 * below loses it, the rest keep their date.
 */
function refreshCompletion(projectUuid: Uuid): void {
  for (const section of db.sections.filter((s) => s.projectUuid === projectUuid)) {
    const own = db.tasks.filter((t) => t.sectionUuid === section.uuid);
    const complete = own.length > 0 && own.every(isResolved);
    if (complete && !section.completedAt) {
      section.completedAt = nowIso();
      log(projectUuid, "section.completed", section.title, { kind: section.kind });
    } else if (!complete && section.completedAt) {
      section.completedAt = null;
    }
  }
}

/** Projects are served with up-to-date stats, exactly as the backend will. */
function withStats(project: Project): Project {
  const tasks = db.tasks.filter((t) => t.projectUuid === project.uuid);
  const sections = db.sections.filter((s) => s.projectUuid === project.uuid);
  return { ...project, stats: computeStats(tasks, sections) };
}

function requireOwnPending(invitation: ProjectInvitation): void {
  const me = requireUser();
  if (me.email.toLowerCase() !== invitation.email) throw new ApiError(403, "forbidden", `This invitation was sent to ${invitation.email}. Sign in with that account to accept it.`);
  if (invitation.status !== "pending") throw new ApiError(409, "conflict", "This invitation is no longer open.");
}

function acceptMock(invitation: ProjectInvitation): Project {
  requireOwnPending(invitation);
  const project = requireProject(invitation.projectUuid);
  const me = actor();
  if (!project.members.some((m) => m.user.uuid === me.uuid)) {
    project.members.push({ uuid: newUuid(), user: me, role: invitation.role, joinedAt: nowIso() });
  }
  invitation.status = "accepted";
  invitation.respondedAt = nowIso();
  log(project.uuid, "member.joined", `${me.name} joined as ${invitation.role}`, { role: invitation.role });
  return clone(withStats(project));
}

export const mockApi: ScopeApi = {
  async getCurrentUser() {
    await wait(80);
    return db.currentUser ? clone(db.currentUser) : null;
  },

  async login({ email, password }) {
    await wait(200);
    const user = db.users.find((u) => u.email === email.trim().toLowerCase());
    if (!user) throw new ApiError(401, "invalid_credentials", "The e-mail or password is incorrect.");
    const expected = db.passwords.get(user.uuid) ?? MOCK_PASSWORD;
    if (password !== expected) throw new ApiError(401, "invalid_credentials", "The e-mail or password is incorrect.");
    if (db.disabledUsers.has(user.uuid)) throw new ApiError(403, "account_disabled", "This account has been disabled. Contact an administrator.");
    if (db.pendingUsers.has(user.uuid)) throw new ApiError(403, "account_pending", "This account is waiting for an administrator to approve it.");
    db.currentUser = clone(user);
    return clone(user);
  },

  async register({ name, email, password }) {
    await wait(220);
    const normalized = email.trim().toLowerCase();
    if (db.users.some((u) => u.email === normalized)) {
      throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "email", message: "An account with this e-mail already exists." }]);
    }
    if (password.length < 8) throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "password", message: "Use at least 8 characters." }]);
    const bootstrap = activeAdmins() === 0;
    const user: User = { uuid: newUuid(), name: name.trim(), email: normalized, role: bootstrap ? "admin" : "user", avatarUrl: null, createdAt: nowIso(), updatedAt: nowIso() };
    db.users.push(user);
    db.passwords.set(user.uuid, password);
    if (bootstrap) {
      db.currentUser = clone(user);
      return { user: clone(user), pendingApproval: false };
    }
    db.pendingUsers.add(user.uuid);
    return { user: clone(user), pendingApproval: true };
  },

  async logout() {
    await wait(80);
    db.currentUser = null;
  },

  async updateProfile(input) {
    await wait(120);
    const user = requireUser();
    if (input.name !== undefined) user.name = input.name.trim();
    if (input.email !== undefined) user.email = input.email.trim().toLowerCase();
    user.updatedAt = nowIso();
    const stored = db.users.find((u) => u.uuid === user.uuid);
    if (stored) Object.assign(stored, user);
    return clone(user);
  },

  async changePassword({ currentPassword, newPassword }) {
    await wait(120);
    const me = requireUser();
    const expected = db.passwords.get(me.uuid) ?? MOCK_PASSWORD;
    if (currentPassword !== expected) {
      throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "currentPassword", message: "Your current password is incorrect." }]);
    }
    if (newPassword.length < 8) throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "newPassword", message: "Use at least 8 characters." }]);
    db.passwords.set(me.uuid, newPassword);
  },

  async requestPasswordReset() {
    await wait(200);
  },

  async resetPassword() {
    await wait(200);
    throw new ApiError(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
  },

  async listProjects() {
    await wait();
    return clone(db.projects.map(withStats));
  },

  async getProject(uuid) {
    await wait(120);
    const project = db.projects.find((p) => p.uuid === uuid);
    if (!project) throw new Error(`Project ${uuid} not found`);
    return clone(withStats(project));
  },

  async listSections(projectUuid) {
    await wait(120);
    return clone(db.sections.filter((s) => s.projectUuid === projectUuid).sort((a, b) => a.position - b.position));
  },

  async listPhases(projectUuid) {
    await wait(80);
    return clone(db.phases.filter((p) => p.projectUuid === projectUuid).sort((a, b) => a.position - b.position));
  },

  async listTasks(projectUuid) {
    await wait(160);
    return clone(db.tasks.filter((t) => t.projectUuid === projectUuid).sort((a, b) => a.position - b.position));
  },

  async listComments(taskUuid) {
    await wait(100);
    return clone(db.comments.filter((c) => c.taskUuid === taskUuid));
  },

  async listActivity(projectUuid) {
    await wait(140);
    const me = requireUser();
    if (projectUuid) requireActivityOwner(requireProject(projectUuid));
    const owned = new Set(db.projects.filter((p) => p.owner.uuid === me.uuid).map((p) => p.uuid));
    const items = db.activities.filter((a) => (projectUuid ? a.projectUuid === projectUuid : owned.has(a.projectUuid)));
    return clone([...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  },

  async listActivityPage(query) {
    await wait(140);
    const me = requireUser();
    if (query.project) requireActivityOwner(requireProject(query.project));
    const owned = new Set(db.projects.filter((p) => p.owner.uuid === me.uuid).map((p) => p.uuid));
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const actions = query.type && query.type !== "all" ? new Set<ActivityAction>(ACTIVITY_TYPE_ACTIONS[query.type]) : null;
    const items = db.activities
      .filter((a) => (query.project ? a.projectUuid === query.project : owned.has(a.projectUuid)) && (!actions || actions.has(a.action)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = items.length;
    return { items: clone(items.slice((page - 1) * perPage, page * perPage)), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  },

  // ---- membership & invitations -----------------------------------------

  async listProjectInvitations(projectUuid) {
    await wait(100);
    requireManage(requireProject(projectUuid));
    const rank = (s: ProjectInvitation["status"]) => (s === "pending" ? 0 : 1);
    return clone(db.invitations.filter((i) => i.projectUuid === projectUuid).sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.localeCompare(a.createdAt)));
  },

  async inviteMember(projectUuid, input) {
    await wait(160);
    const project = requireProject(projectUuid);
    requireManage(project);
    const email = input.email.trim().toLowerCase();
    if (project.members.some((m) => m.user.email === email)) throw validationError("email", "That person is already a member of this project.");
    if (db.invitations.some((i) => i.projectUuid === projectUuid && i.email === email && i.status === "pending")) throw validationError("email", "An invitation for this e-mail is already pending.");
    const invitation: ProjectInvitation = { uuid: newUuid(), projectUuid, projectName: project.name, email, role: input.role, status: "pending", invitedBy: actor(), createdAt: nowIso(), respondedAt: null };
    db.invitations.unshift(invitation);
    log(projectUuid, "member.invited", email, { role: input.role });
    return clone(invitation);
  },

  async revokeInvitation(projectUuid, invitationUuid) {
    await wait(120);
    requireManage(requireProject(projectUuid));
    const invitation = db.invitations.find((i) => i.uuid === invitationUuid && i.projectUuid === projectUuid);
    if (!invitation) throw new ApiError(404, "not_found", "Invitation was not found.");
    if (invitation.status !== "pending") throw new ApiError(409, "conflict", "This invitation has already been answered.");
    invitation.status = "revoked";
    invitation.respondedAt = nowIso();
    log(projectUuid, "member.invitation_revoked", invitation.email);
    return clone(invitation);
  },

  async updateMemberRole(projectUuid, memberUuid, role) {
    await wait(120);
    const project = requireProject(projectUuid);
    requireManage(project);
    const member = project.members.find((m) => m.uuid === memberUuid);
    if (!member) throw new ApiError(404, "not_found", "Member was not found.");
    if (member.role === "owner") throw new ApiError(409, "conflict", "Transfer ownership to change the owner's role.");
    if (member.role !== role) {
      log(projectUuid, "member.role_changed", member.user.name, { from: member.role, to: role });
      member.role = role;
    }
    return clone(withStats(project));
  },

  async removeMember(projectUuid, memberUuid) {
    await wait(120);
    const project = requireProject(projectUuid);
    const member = project.members.find((m) => m.uuid === memberUuid);
    if (!member) throw new ApiError(404, "not_found", "Member was not found.");
    if (member.user.uuid === requireUser().uuid) throw new ApiError(409, "conflict", "Use “Leave project” to remove yourself.");
    requireManage(project);
    if (member.role === "owner") throw new ApiError(409, "conflict", "The owner cannot be removed. Transfer ownership first.");
    project.members = project.members.filter((m) => m.uuid !== memberUuid);
    log(projectUuid, "member.removed", member.user.name, { role: member.role });
    return clone(withStats(project));
  },

  async transferOwnership(projectUuid, memberUuid) {
    await wait(160);
    const project = requireProject(projectUuid);
    requireManage(project);
    const target = project.members.find((m) => m.uuid === memberUuid);
    if (!target) throw new ApiError(404, "not_found", "Member was not found.");
    if (target.role === "owner") throw new ApiError(409, "conflict", "That member already owns the project.");
    const current = project.members.find((m) => m.role === "owner");
    if (current) current.role = "editor";
    target.role = "owner";
    project.owner = target.user;
    log(projectUuid, "project.ownership_transferred", project.name, { to: target.user.name });
    return clone(withStats(project));
  },

  async leaveProject(projectUuid) {
    await wait(120);
    const project = requireProject(projectUuid);
    const me = requireUser();
    const member = project.members.find((m) => m.user.uuid === me.uuid);
    if (!member) throw new ApiError(403, "forbidden", "You are not a member of this project.");
    if (member.role === "owner") throw new ApiError(409, "conflict", "Owners cannot leave. Transfer ownership first.");
    log(projectUuid, "member.left", member.user.name, { role: member.role });
    project.members = project.members.filter((m) => m.uuid !== member.uuid);
  },

  async listMyInvitations() {
    await wait(100);
    const me = requireUser();
    return clone(db.invitations.filter((i) => i.status === "pending" && i.email === me.email.toLowerCase()));
  },

  async acceptInvitation(invitationUuid) {
    await wait(160);
    const invitation = db.invitations.find((i) => i.uuid === invitationUuid);
    if (!invitation) throw new ApiError(404, "not_found", "Invitation was not found.");
    return acceptMock(invitation);
  },

  async acceptInvitationByToken(token) {
    await wait(160);
    // Mock tokens are the invitation uuid; anything else is treated as expired.
    const invitation = db.invitations.find((i) => i.uuid === token && i.status === "pending");
    if (!invitation) throw new ApiError(400, "invalid_token", "This invitation link is invalid, has expired or was already used.");
    return acceptMock(invitation);
  },

  async declineInvitation(invitationUuid) {
    await wait(120);
    const invitation = db.invitations.find((i) => i.uuid === invitationUuid);
    if (!invitation) throw new ApiError(404, "not_found", "Invitation was not found.");
    requireOwnPending(invitation);
    invitation.status = "declined";
    invitation.respondedAt = nowIso();
    log(invitation.projectUuid, "member.invitation_declined", invitation.email);
  },

  async listExportTemplates() {
    await wait(80);
    return clone(seed.exportTemplates);
  },

  /**
   * The mock cannot build a real DOCX; it produces a plain-text rendition of
   * the same document model so the download flow (options → file → activity)
   * can be exercised without the API.
   */
  async exportProject(projectUuid, input) {
    await wait(400);
    const project = requireProject(projectUuid);
    const all = db.sections.filter((s) => s.projectUuid === projectUuid).sort((a, b) => a.position - b.position);
    const sections = input.sectionUuids ? all.filter((s) => input.sectionUuids!.includes(s.uuid)) : all;
    if (sections.length === 0) throw validationError("sectionUuids", "Select at least one scope or revision to include.");
    const template = (input.templateUuid ? seed.exportTemplates.find((t) => t.uuid === input.templateUuid) : seed.exportTemplates.find((t) => t.isDefault)) ?? null;
    if (!template) throw validationError("templateUuid", "That document template does not exist.");

    const lines: string[] = [`PURCHASE ORDER CHECKLIST`, `FOR`, project.name, project.description, ""];
    let taskCount = 0;
    // Scope sections first, then revisions in their own block — the same split as the DOCX.
    const block = (list: ChecklistSection[], prefix: string) =>
      list.forEach((section, index) => {
        const asOf = revisionAsOf(section);
        lines.push(`${prefix}${index + 1}. ${section.title}${asOf ? ` · Revision as of ${formatLongDate(asOf)}` : ""}`);
        for (const task of db.tasks.filter((t) => t.sectionUuid === section.uuid).sort((a, b) => a.position - b.position)) {
          taskCount += 1;
          lines.push(`  [${task.developerCheck ? "x" : " "}] [${task.clientCheck ? "x" : " "}] ${task.title} — ${TASK_STATUS_LABELS[task.status]}`);
          if (input.includeDescriptions !== false && task.description) lines.push(`        ${task.description}`);
        }
        lines.push("");
      });
    block(sections.filter((s) => s.kind !== "revision"), "");
    const revisions = sections.filter((s) => s.kind === "revision");
    if (revisions.length > 0) {
      lines.push("REVISIONS", "");
      block(revisions, "R");
    }
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const fileName = `${slug}-scope-checklist-${nowIso().slice(0, 10)}.docx`;
    log(projectUuid, "export.generated", fileName, { template: template.name, sections: sections.length, tasks: taskCount, partial: sections.length !== all.length });
    return { blob: new Blob([lines.join("\n")], { type: "text/plain" }), fileName, template: template.name, sectionCount: sections.length, taskCount };
  },

  async createProject(input) {
    await wait(160);
    const owner = actor();
    const project: Project = {
      uuid: newUuid(),
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      owner,
      status: "active",
      startDate: input.startDate ?? null,
      deadline: input.deadline ?? null,
      stats: { totalTasks: 0, completedTasks: 0, completionPercent: 0, sectionCount: 1, overdueTasks: 0 },
      members: [{ uuid: newUuid(), user: owner, role: "owner", joinedAt: nowIso() }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.projects.unshift(project);
    // Every project starts with one section so the user can add tasks immediately.
    db.sections.push({ uuid: newUuid(), projectUuid: project.uuid, title: "General", description: null, kind: "scope", references: [], phaseUuid: null, position: 0, completedAt: null, revisionDate: null, createdAt: nowIso(), updatedAt: nowIso() });
    log(project.uuid, "project.created", project.name);
    return clone(project);
  },

  async updateProject(projectUuid, input) {
    await wait(140);
    const project = db.projects.find((p) => p.uuid === projectUuid);
    if (!project) throw new ApiError(404, "not_found", "Project was not found.");
    const start = input.startDate === undefined ? project.startDate : input.startDate;
    const end = input.deadline === undefined ? project.deadline : input.deadline;
    if (start && end && end < start) {
      throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "deadline", message: "The deadline must be after the start date." }]);
    }
    const previousStatus = project.status;
    if (input.name !== undefined) project.name = input.name.trim();
    if (input.description !== undefined) project.description = input.description.trim();
    if (input.startDate !== undefined) project.startDate = input.startDate;
    if (input.deadline !== undefined) project.deadline = input.deadline;
    if (input.status !== undefined) project.status = input.status;
    project.updatedAt = nowIso();
    if (input.name !== undefined || input.description !== undefined || input.startDate !== undefined || input.deadline !== undefined) log(projectUuid, "project.updated", project.name);
    if (input.status !== undefined && input.status !== previousStatus) log(projectUuid, "project.status_changed", project.name, { from: previousStatus, to: input.status });
    return clone(withStats(project));
  },

  async deleteProject(projectUuid) {
    await wait(140);
    const project = db.projects.find((p) => p.uuid === projectUuid);
    if (!project) throw new ApiError(404, "not_found", "Project was not found.");
    log(projectUuid, "project.deleted", project.name);
    // Soft delete, as on the server: the project moves to the admin registry's "Deleted" list and can be restored.
    db.deletedProjects.unshift({ ...withStats(project), deletedAt: nowIso(), updatedAt: nowIso() });
    db.projects = db.projects.filter((p) => p.uuid !== projectUuid);
  },

  // ---- administration -----------------------------------------------------

  async adminStats() {
    await wait(180);
    requireAdmin();
    const now = Date.now();
    const today = nowIso().slice(0, 10);
    const since = (days: number) => new Date(now - days * 86_400_000).toISOString();
    const resolved = new Set<TaskStatus>(["done_for_production", "done", "completed", "not_applicable"]);
    const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const t of db.tasks) byStatus[t.status] += 1;
    const exportsAll = db.activities.filter((a) => a.action === "export.generated");
    return {
      users: {
        total: db.users.length,
        admins: db.users.filter((u) => u.role === "admin").length,
        disabled: db.disabledUsers.size,
        pending: db.pendingUsers.size,
        newLast30Days: db.users.filter((u) => u.createdAt >= since(30)).length,
        activeLast7Days: db.users.filter((u) => u.updatedAt >= since(7)).length,
      },
      projects: {
        total: db.projects.length,
        active: db.projects.filter((p) => p.status === "active").length,
        completed: db.projects.filter((p) => p.status === "completed").length,
        archived: db.projects.filter((p) => p.status === "archived").length,
        deleted: db.deletedProjects.length,
        overdue: db.projects.filter((p) => p.status === "active" && p.deadline !== null && p.deadline < today).length,
      },
      tasks: {
        total: db.tasks.length,
        completed: db.tasks.filter((t) => resolved.has(t.status)).length,
        overdue: db.tasks.filter((t) => !resolved.has(t.status) && t.dueDate !== null && t.dueDate < today).length,
        byStatus,
      },
      collaboration: {
        memberships: db.projects.reduce((n, p) => n + p.members.length, 0),
        pendingInvitations: db.invitations.filter((i) => i.status === "pending").length,
        comments: db.comments.length,
      },
      exports: { total: exportsAll.length, last30Days: exportsAll.filter((a) => a.createdAt >= since(30)).length },
      activity: { last7Days: db.activities.filter((a) => a.createdAt >= since(7)).length },
      errors: { total: db.errorLogs.length, last24Hours: db.errorLogs.filter((e) => e.createdAt >= since(1)).length, last7Days: db.errorLogs.filter((e) => e.createdAt >= since(7)).length },
      generatedAt: nowIso(),
    };
  },

  async adminListUsers(query) {
    await wait(160);
    requireAdmin();
    const q = query.search?.trim().toLowerCase() ?? "";
    const items = db.users
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .filter((u) => !query.role || query.role === "all" || u.role === query.role)
      .filter((u) => {
        if (!query.status || query.status === "all") return true;
        if (query.status === "disabled") return db.disabledUsers.has(u.uuid);
        if (query.status === "pending") return !db.disabledUsers.has(u.uuid) && db.pendingUsers.has(u.uuid);
        return !db.disabledUsers.has(u.uuid) && !db.pendingUsers.has(u.uuid);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toAdminUser);
    return paginate(items, query.page, query.perPage);
  },

  async adminUpdateUser(userUuid, input) {
    await wait(160);
    const me = requireAdmin();
    const user = requireDirectoryUser(userUuid);
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (db.users.some((u) => u.uuid !== userUuid && u.email === email)) throw new ApiError(409, "conflict", "That email is already in use.", [{ field: "email", message: "Already in use." }]);
    }
    const roleChanged = input.role !== undefined && input.role !== user.role;
    if (roleChanged) {
      if (user.uuid === me.uuid) throw new ApiError(409, "conflict", "You cannot change your own role.");
      if (user.role === "admin" && !db.disabledUsers.has(user.uuid) && activeAdmins() <= 1) throw new ApiError(409, "conflict", "At least one enabled administrator is required.");
    }
    const detailsChanged = (input.name !== undefined && input.name.trim() !== user.name) || (input.email !== undefined && input.email.trim().toLowerCase() !== user.email);
    if (input.name !== undefined) user.name = input.name.trim();
    if (input.email !== undefined) user.email = input.email.trim().toLowerCase();
    if (detailsChanged) audit("user.updated", "user", user.uuid, user.name, { fields: Object.keys(input).filter((k) => k !== "role") });
    if (roleChanged) {
      audit("user.role_changed", "user", user.uuid, user.name, { from: user.role, to: input.role });
      user.role = input.role!;
    }
    user.updatedAt = nowIso();
    // Keep embedded summaries (owners, members, actors) in sync, as the server's joins would.
    for (const p of db.projects) {
      if (p.owner.uuid === user.uuid) p.owner = { ...p.owner, name: user.name, email: user.email };
      for (const m of p.members) if (m.user.uuid === user.uuid) m.user = { ...m.user, name: user.name, email: user.email };
    }
    return toAdminUser(user);
  },

  async adminApproveUser(userUuid) {
    await wait(140);
    requireAdmin();
    const user = requireDirectoryUser(userUuid);
    if (db.pendingUsers.has(user.uuid)) {
      db.pendingUsers.delete(user.uuid);
      audit("user.approved", "user", user.uuid, user.name);
    }
    return toAdminUser(user);
  },

  async adminSetUserDisabled(userUuid, disabled) {
    await wait(140);
    const me = requireAdmin();
    const user = requireDirectoryUser(userUuid);
    if (disabled) {
      if (user.uuid === me.uuid) throw new ApiError(409, "conflict", "You cannot disable your own account.");
      if (user.role === "admin" && !db.disabledUsers.has(user.uuid) && activeAdmins() <= 1) throw new ApiError(409, "conflict", "At least one enabled administrator is required.");
    }
    if (db.disabledUsers.has(user.uuid) !== disabled) {
      if (disabled) db.disabledUsers.add(user.uuid);
      else db.disabledUsers.delete(user.uuid);
      audit(disabled ? "user.disabled" : "user.enabled", "user", user.uuid, user.name);
    }
    return toAdminUser(user);
  },

  async adminRevokeUserSessions(userUuid) {
    await wait(120);
    requireAdmin();
    const user = requireDirectoryUser(userUuid);
    audit("user.sessions_revoked", "user", user.uuid, user.name);
  },

  async adminSetUserPassword(userUuid, input) {
    await wait(140);
    requireAdmin();
    const user = requireDirectoryUser(userUuid);
    if (db.disabledUsers.has(user.uuid)) throw new ApiError(409, "conflict", "Enable the account before changing the password.");
    if (input.password.length < 8) throw new ApiError(422, "validation_failed", "Please fix the highlighted fields.", [{ field: "password", message: "Use at least 8 characters." }]);
    db.passwords.set(user.uuid, input.password);
    audit("user.password_changed", "user", user.uuid, user.name);
  },

  async adminSendPasswordReset(userUuid) {
    await wait(160);
    requireAdmin();
    const user = requireDirectoryUser(userUuid);
    if (db.disabledUsers.has(user.uuid)) throw new ApiError(409, "conflict", "Enable the account before sending a password reset.");
    if (db.pendingUsers.has(user.uuid)) throw new ApiError(409, "conflict", "Approve the account before sending a password reset.");
    audit("user.password_reset_sent", "user", user.uuid, user.name);
  },

  async adminListProjects(query) {
    await wait(160);
    requireAdmin();
    const q = query.search?.trim().toLowerCase() ?? "";
    const matches = (p: Project) => !q || p.name.toLowerCase().includes(q) || p.owner.name.toLowerCase().includes(q);
    const items: AdminProject[] =
      query.status === "deleted"
        ? db.deletedProjects.filter(matches)
        : db.projects
            .filter((p) => (!query.status || query.status === "all" || p.status === query.status) && matches(p))
            .map((p) => ({ ...withStats(p), deletedAt: null }));
    return paginate([...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), query.page, query.perPage);
  },

  async adminRestoreProject(projectUuid) {
    await wait(180);
    requireAdmin();
    const project = db.deletedProjects.find((p) => p.uuid === projectUuid);
    if (!project) {
      if (db.projects.some((p) => p.uuid === projectUuid)) throw new ApiError(409, "conflict", "This project is not deleted.");
      throw new ApiError(404, "not_found", "Project was not found.");
    }
    db.deletedProjects = db.deletedProjects.filter((p) => p.uuid !== projectUuid);
    const { deletedAt: _deletedAt, ...live } = project;
    void _deletedAt;
    const restored: Project = { ...live, updatedAt: nowIso() };
    db.projects.unshift(restored);
    if (!db.sections.some((s) => s.projectUuid === projectUuid)) {
      db.sections.push({ uuid: newUuid(), projectUuid, title: "General", description: null, kind: "scope", references: [], phaseUuid: null, position: 0, completedAt: null, revisionDate: null, createdAt: nowIso(), updatedAt: nowIso() });
    }
    log(projectUuid, "project.restored", restored.name);
    audit("project.restored", "project", projectUuid, restored.name);
    return { ...withStats(restored), deletedAt: null };
  },

  async adminListAudit(query) {
    await wait(120);
    requireAdmin();
    return paginate(db.adminAudit, query.page, query.perPage);
  },

  async adminListErrors(query) {
    await wait(120);
    requireAdmin();
    const search = query.search?.trim().toLowerCase();
    const items = db.errorLogs.filter(
      (e) => (!query.source || query.source === "all" || e.source === query.source) && (!search || [e.message, e.code ?? "", e.path ?? ""].some((v) => v.toLowerCase().includes(search))),
    );
    return paginate(items, query.page, query.perPage);
  },

  async adminGetError(errorUuid) {
    await wait(80);
    requireAdmin();
    const entry = db.errorLogs.find((e) => e.uuid === errorUuid);
    if (!entry) throw new ApiError(404, "not_found", "Error log entry was not found.");
    return clone(entry);
  },

  async reportError(report) {
    await wait(40);
    const me = db.currentUser;
    const entry: AdminErrorLog = {
      uuid: newUuid(),
      source: "web",
      status: null,
      code: report.name ?? null,
      message: report.message,
      stack: report.stack ?? null,
      method: null,
      path: report.path ?? null,
      actor: me ? { uuid: me.uuid, name: me.name, email: me.email, avatarUrl: me.avatarUrl } : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      context: report.context ?? null,
      createdAt: nowIso(),
    };
    db.errorLogs.unshift(entry);
  },

  async adminProductivity(query) {
    await wait(160);
    requireAdmin();
    const period = query.period ?? "30d";
    const days = { "7d": 7, "30d": 30, "90d": 90, all: null }[period];
    const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
    const emptyCounts = () => Object.fromEntries(Object.keys(PRODUCTIVITY_WEIGHTS).map((k) => [k, 0])) as Record<ProductivityBucket, number>;

    const entries: AdminProductivityEntry[] = db.users.map((u) => {
      const mine = db.activities.filter((a) => a.actor.uuid === u.uuid && (!since || a.createdAt >= since));
      const counts = emptyCounts();
      for (const a of mine) counts[productivityBucket(a.action, a.meta)] += 1;
      return {
        user: { uuid: u.uuid, name: u.name, email: u.email, avatarUrl: u.avatarUrl },
        disabled: db.disabledUsers.has(u.uuid),
        counts,
        totalActions: mine.length,
        score: productivityScore(counts),
        activeDays: new Set(mine.map((a) => a.createdAt.slice(0, 10))).size,
        projects: new Set(mine.map((a) => a.projectUuid)).size,
        lastActiveAt: mine.reduce<string | null>((latest, a) => (!latest || a.createdAt > latest ? a.createdAt : latest), null),
      };
    });
    entries.sort((a, b) => b.score - a.score || b.totalActions - a.totalActions || a.user.name.localeCompare(b.user.name));
    return {
      period,
      since,
      entries,
      totals: { actions: entries.reduce((s, e) => s + e.totalActions, 0), score: entries.reduce((s, e) => s + e.score, 0), activeUsers: entries.filter((e) => e.totalActions > 0).length },
      weights: PRODUCTIVITY_WEIGHTS,
      generatedAt: nowIso(),
    };
  },

  async updateSection(sectionUuid, input) {
    await wait(100);
    const section = db.sections.find((s) => s.uuid === sectionUuid);
    if (!section) throw new ApiError(404, "not_found", "Scope was not found.");
    if (input.title !== undefined) {
      const nextTitle = input.title.trim();
      if (nextTitle.length > SECTION_TITLE_MAX_LENGTH) {
        throw validationError("title", `Use at most ${SECTION_TITLE_MAX_LENGTH} characters.`);
      }
      section.title = nextTitle;
    }
    if (input.description !== undefined) section.description = input.description?.trim() || null;
    if (input.kind !== undefined) section.kind = input.kind;
    if (input.phaseUuid !== undefined) {
      if (input.phaseUuid !== null && !db.phases.some((p) => p.uuid === input.phaseUuid && p.projectUuid === section.projectUuid)) {
        throw new ApiError(422, "validation_error", "The phase does not belong to this project.", [{ field: "phaseUuid", message: "The phase does not belong to this project." }]);
      }
      section.phaseUuid = input.phaseUuid;
    }
    if (input.revisionDate !== undefined) section.revisionDate = input.revisionDate;
    section.updatedAt = nowIso();
    log(section.projectUuid, "section.updated", section.title);
    return clone(section);
  },

  async deleteSection(sectionUuid) {
    await wait(120);
    const section = db.sections.find((s) => s.uuid === sectionUuid);
    if (!section) throw new ApiError(404, "not_found", "Scope was not found.");
    if (db.sections.filter((s) => s.projectUuid === section.projectUuid).length <= 1) {
      throw new ApiError(409, "conflict", "A project needs at least one scope or revision. Rename this one instead.");
    }
    const taskUuids = new Set(db.tasks.filter((t) => t.sectionUuid === sectionUuid).map((t) => t.uuid));
    db.tasks = db.tasks.filter((t) => t.sectionUuid !== sectionUuid);
    db.comments = db.comments.filter((c) => !taskUuids.has(c.taskUuid));
    db.sections = db.sections.filter((s) => s.uuid !== sectionUuid);
    log(section.projectUuid, "section.deleted", section.title, { taskCount: taskUuids.size });
  },

  async reorderSections(projectUuid, input) {
    await wait(60);
    input.orderedSectionUuids.forEach((uuid, index) => {
      const section = db.sections.find((s) => s.uuid === uuid && s.projectUuid === projectUuid);
      if (section) section.position = index;
    });
    return clone(db.sections.filter((s) => s.projectUuid === projectUuid).sort((a, b) => a.position - b.position));
  },

  async createSection(projectUuid, input) {
    await wait(120);
    const siblings = db.sections.filter((s) => s.projectUuid === projectUuid);
    if (input.phaseUuid && !db.phases.some((p) => p.uuid === input.phaseUuid && p.projectUuid === projectUuid)) {
      throw new ApiError(422, "validation_error", "The phase does not belong to this project.", [{ field: "phaseUuid", message: "The phase does not belong to this project." }]);
    }
    if (input.title.trim().length > SECTION_TITLE_MAX_LENGTH) {
      throw validationError("title", `Use at most ${SECTION_TITLE_MAX_LENGTH} characters.`);
    }
    const section: ChecklistSection = {
      uuid: newUuid(),
      projectUuid,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      kind: input.kind ?? "scope",
      phaseUuid: input.phaseUuid ?? null,
      position: siblings.length,
      completedAt: null,
      revisionDate: input.revisionDate ?? null,
      references: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    if (input.reference) {
      section.references.push(buildSectionReference(section.uuid, input.reference, "reference"));
      log(projectUuid, input.reference.kind === "link" ? "section.link_added" : "section.note_added", section.title);
    }
    db.sections.push(section);
    return clone(section);
  },

  async createPhase(projectUuid, input) {
    await wait(100);
    const siblings = db.phases.filter((p) => p.projectUuid === projectUuid);
    const phase: Phase = {
      uuid: newUuid(),
      projectUuid,
      title: input.title.trim(),
      color: input.color ?? defaultPhaseColor(siblings.length),
      position: siblings.length,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.phases.push(phase);
    log(projectUuid, "phase.created", phase.title);
    return clone(phase);
  },

  async updatePhase(phaseUuid, input) {
    await wait(80);
    const phase = db.phases.find((p) => p.uuid === phaseUuid);
    if (!phase) throw new ApiError(404, "not_found", "Phase was not found.");
    if (input.title !== undefined) phase.title = input.title.trim();
    if (input.color !== undefined) phase.color = input.color;
    phase.updatedAt = nowIso();
    log(phase.projectUuid, "phase.updated", phase.title);
    return clone(phase);
  },

  async deletePhase(phaseUuid) {
    await wait(80);
    const phase = db.phases.find((p) => p.uuid === phaseUuid);
    if (!phase) throw new ApiError(404, "not_found", "Phase was not found.");
    for (const section of db.sections) if (section.phaseUuid === phaseUuid) section.phaseUuid = null;
    db.phases = db.phases.filter((p) => p.uuid !== phaseUuid);
    log(phase.projectUuid, "phase.deleted", phase.title);
  },

  async reorderPhases(projectUuid, input) {
    await wait(60);
    input.orderedPhaseUuids.forEach((uuid, index) => {
      const phase = db.phases.find((p) => p.uuid === uuid && p.projectUuid === projectUuid);
      if (phase) phase.position = index;
    });
    return clone(db.phases.filter((p) => p.projectUuid === projectUuid).sort((a, b) => a.position - b.position));
  },

  async createTask(projectUuid, input) {
    await wait(120);
    const siblings = db.tasks.filter((t) => t.sectionUuid === input.sectionUuid);
    const assignee = input.assigneeUuid ? db.users.find((u) => u.uuid === input.assigneeUuid) ?? null : null;
    const task: Task = {
      uuid: newUuid(),
      projectUuid,
      sectionUuid: input.sectionUuid,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: "not_started",
      developerCheck: null,
      clientCheck: null,
      dueDate: input.dueDate ?? null,
      priority: input.priority ?? "medium",
      assignee: assignee ? { uuid: assignee.uuid, name: assignee.name, email: assignee.email, avatarUrl: assignee.avatarUrl } : null,
      position: siblings.length,
      commentCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.tasks.push(task);
    refreshCompletion(projectUuid);
    return clone(task);
  },

  async updateTask(taskUuid, input) {
    await wait(90);
    const task = requireTask(taskUuid);
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.description !== undefined) task.description = input.description?.trim() || null;
    if (input.dueDate !== undefined) task.dueDate = input.dueDate;
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.assigneeUuid !== undefined) {
      const user = input.assigneeUuid ? db.users.find((u) => u.uuid === input.assigneeUuid) : null;
      task.assignee = user ? { uuid: user.uuid, name: user.name, email: user.email, avatarUrl: user.avatarUrl } : null;
    }
    if (input.sectionUuid !== undefined && input.sectionUuid !== task.sectionUuid) {
      task.sectionUuid = input.sectionUuid;
      task.position = db.tasks.filter((t) => t.sectionUuid === input.sectionUuid).length;
    }
    if (input.status !== undefined && input.status !== task.status) {
      log(task.projectUuid, "task.status_changed", task.title, { from: task.status, to: input.status });
      task.status = input.status;
    }
    // "Checked by" boxes: the server stamps the acting user and time.
    if (input.developerChecked !== undefined && input.developerChecked !== (task.developerCheck !== null)) {
      task.developerCheck = input.developerChecked ? { checkedBy: actor(), checkedAt: nowIso() } : null;
      log(task.projectUuid, input.developerChecked ? "task.checked" : "task.unchecked", task.title, { side: "developer" });
    }
    if (input.clientChecked !== undefined && input.clientChecked !== (task.clientCheck !== null)) {
      task.clientCheck = input.clientChecked ? { checkedBy: actor(), checkedAt: nowIso() } : null;
      log(task.projectUuid, input.clientChecked ? "task.checked" : "task.unchecked", task.title, { side: "client" });
    }
    task.updatedAt = nowIso();
    refreshCompletion(task.projectUuid);
    return clone(task);
  },

  async deleteTask(taskUuid) {
    await wait(90);
    const task = db.tasks.find((t) => t.uuid === taskUuid);
    db.tasks = db.tasks.filter((t) => t.uuid !== taskUuid);
    db.comments = db.comments.filter((c) => c.taskUuid !== taskUuid);
    if (task) refreshCompletion(task.projectUuid);
  },

  async reorderTasks(projectUuid, input) {
    await wait(60);
    input.orderedTaskUuids.forEach((uuid, index) => {
      const task = db.tasks.find((t) => t.uuid === uuid && t.projectUuid === projectUuid);
      if (task) {
        task.position = index;
        task.sectionUuid = input.sectionUuid;
      }
    });
    refreshCompletion(projectUuid);
    return clone(db.tasks.filter((t) => t.sectionUuid === input.sectionUuid).sort((a, b) => a.position - b.position));
  },

  async addComment(taskUuid, body) {
    await wait(100);
    const task = requireTask(taskUuid);
    const comment: TaskComment = {
      uuid: newUuid(),
      taskUuid,
      author: actor(),
      body: body.trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.comments.push(comment);
    task.commentCount += 1;
    log(task.projectUuid, "comment.added", task.title);
    return clone(comment);
  },

  async listSectionReferences(sectionUuid) {
    await wait(80);
    const section = requireSection(sectionUuid);
    requireProjectMember(requireProject(section.projectUuid));
    return clone(section.references);
  },

  async addSectionReference(sectionUuid, input) {
    await wait(100);
    const section = requireSection(sectionUuid);
    requireEditableProject(requireProject(section.projectUuid));
    const reference = buildSectionReference(sectionUuid, input);
    section.references.push(reference);
    section.updatedAt = reference.updatedAt;
    log(section.projectUuid, input.kind === "link" ? "section.link_added" : "section.note_added", section.title);
    return clone(reference);
  },

  async deleteSectionReference(sectionUuid, referenceUuid) {
    await wait(80);
    const section = requireSection(sectionUuid);
    requireEditableProject(requireProject(section.projectUuid));
    const existing = section.references.find((r) => r.uuid === referenceUuid);
    if (!existing) throw new ApiError(404, "not_found", "Note was not found.");
    section.references = section.references.filter((r) => r.uuid !== referenceUuid);
    section.updatedAt = nowIso();
    log(section.projectUuid, "section.reference_deleted", section.title, { kind: existing.kind });
  },
};
