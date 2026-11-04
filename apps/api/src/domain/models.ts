import type {
  ActivityAction,
  ActivityLog,
  AdminAuditAction,
  AdminAuditEntry,
  AdminErrorLog,
  AdminProject,
  AdminUser,
  ChecklistSection,
  Phase,
  ExportTemplate,
  InvitationStatus,
  Project,
  ProjectInvitation,
  ProjectMember,
  ProjectMemberRole,
  ProjectStats,
  ProjectStatus,
  SystemRole,
  Task,
  TaskCheck,
  TaskComment,
  TaskPriority,
  TaskStatus,
  User,
  UserSummary,
} from "@scope/contracts";
import { fromSqlDate, fromSqlDateTime, toBool } from "../db/database.ts";

/**
 * Row shapes as returned by the repositories (snake_case, DB types) and the
 * mappers that turn them into the public contracts. Internal `id` columns
 * never leave this module except inside `Actor`/`*Record` types used by
 * services.
 */

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Set by an administrator; disabled accounts cannot sign in. */
  disabled_at: string | null;
  /** Set when an administrator approved the account; null while waiting. */
  approved_at: string | null;
  /** Clerk user id (`user_…`) once the account is linked; null under the built-in session auth. */
  clerk_user_id: string | null;
}

/** `UserRow` plus the aggregates shown in the admin directory. */
export interface AdminUserRow extends UserRow {
  last_seen_at: string | null;
  owned_projects: number | string;
  memberships: number | string;
}

export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    ...toUser(row),
    approvedAt: fromSqlDateTime(row.approved_at),
    disabledAt: fromSqlDateTime(row.disabled_at),
    lastSeenAt: fromSqlDateTime(row.last_seen_at),
    ownedProjects: Number(row.owned_projects ?? 0),
    memberships: Number(row.memberships ?? 0),
  };
}

/** The authenticated principal, as needed by services for authorization. */
export interface Actor {
  id: number;
  uuid: string;
  role: SystemRole;
}

export function toUser(row: UserRow): User {
  return {
    uuid: row.uuid,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    avatarUrl: row.avatar_url,
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

export function toUserSummary(row: Pick<UserRow, "uuid" | "name" | "email" | "avatar_url">): UserSummary {
  return { uuid: row.uuid, name: row.name, email: row.email, avatarUrl: row.avatar_url };
}

/** Summary built from prefixed join columns, e.g. `a_uuid`, `a_name`. Null when the join found nothing. */
export function summaryFromPrefix(row: Record<string, unknown>, prefix: string): UserSummary | null {
  const uuid = row[`${prefix}_uuid`];
  if (!uuid) return null;
  return {
    uuid: String(uuid),
    name: String(row[`${prefix}_name`]),
    email: String(row[`${prefix}_email`]),
    avatarUrl: (row[`${prefix}_avatar_url`] as string | null) ?? null,
  };
}

/** SELECT fragment that exposes a joined users alias as prefixed columns. */
export function userSummaryColumns(alias: string, prefix: string): string {
  return `${alias}.uuid AS ${prefix}_uuid, ${alias}.name AS ${prefix}_name, ${alias}.email AS ${prefix}_email, ${alias}.avatar_url AS ${prefix}_avatar_url`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  owner_id: number;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  /** Only selected by the admin registry queries; live queries filter it out. */
  deleted_at?: string | null;
  // owner join
  o_uuid: string;
  o_name: string;
  o_email: string;
  o_avatar_url: string | null;
}

export interface MemberRow extends Record<string, unknown> {
  id?: number;
  uuid: string;
  project_id: number;
  user_id?: number;
  role: string;
  joined_at: string;
  u_uuid: string;
  u_name: string;
  u_email: string;
  u_avatar_url: string | null;
}

export interface StatsRow extends Record<string, unknown> {
  project_id: number;
  total_tasks: number | string;
  completed_tasks: number | string;
  overdue_tasks: number | string;
  section_count: number | string;
}

export function toMember(row: MemberRow): ProjectMember {
  return {
    uuid: row.uuid,
    user: summaryFromPrefix(row, "u")!,
    role: row.role as ProjectMemberRole,
    joinedAt: fromSqlDateTime(row.joined_at)!,
  };
}

export function toStats(row: StatsRow | undefined): ProjectStats {
  const total = Number(row?.total_tasks ?? 0);
  const completed = Number(row?.completed_tasks ?? 0);
  return {
    totalTasks: total,
    completedTasks: completed,
    completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    sectionCount: Number(row?.section_count ?? 0),
    overdueTasks: Number(row?.overdue_tasks ?? 0),
  };
}

export function toProject(row: ProjectRow, members: ProjectMember[], stats: ProjectStats): Project {
  return {
    uuid: row.uuid,
    name: row.name,
    description: row.description ?? "",
    owner: summaryFromPrefix(row, "o")!,
    status: row.status as ProjectStatus,
    startDate: fromSqlDate(row.start_date),
    deadline: fromSqlDate(row.deadline),
    stats,
    members,
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

export function toAdminProject(row: ProjectRow, members: ProjectMember[], stats: ProjectStats): AdminProject {
  return { ...toProject(row, members, stats), deletedAt: fromSqlDateTime(row.deleted_at ?? null) };
}

export interface InvitationRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  project_id: number;
  project_uuid: string;
  project_name: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  responded_at: string | null;
  // inviter join
  i_uuid: string;
  i_name: string;
  i_email: string;
  i_avatar_url: string | null;
}

export function toInvitation(row: InvitationRow): ProjectInvitation {
  return {
    uuid: row.uuid,
    projectUuid: row.project_uuid,
    projectName: row.project_name,
    email: row.email,
    role: row.role === "editor" ? "editor" : "viewer",
    status: row.status as InvitationStatus,
    invitedBy: summaryFromPrefix(row, "i")!,
    createdAt: fromSqlDateTime(row.created_at)!,
    respondedAt: fromSqlDateTime(row.responded_at),
  };
}

// ---------------------------------------------------------------------------
// Sections & tasks
// ---------------------------------------------------------------------------

export interface SectionRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  project_id: number;
  project_uuid: string;
  title: string;
  description: string | null;
  kind: string;
  phase_id: number | null;
  phase_uuid: string | null;
  position: number;
  completed_at: string | null;
  revision_date: string | null;
  created_at: string;
  updated_at: string;
}

export function toSection(row: SectionRow): ChecklistSection {
  return {
    uuid: row.uuid,
    projectUuid: row.project_uuid,
    title: row.title,
    description: row.description,
    kind: row.kind === "revision" ? "revision" : "scope",
    phaseUuid: row.phase_uuid,
    position: Number(row.position),
    completedAt: fromSqlDateTime(row.completed_at),
    revisionDate: fromSqlDate(row.revision_date),
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

export interface PhaseRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  project_id: number;
  project_uuid: string;
  title: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export function toPhase(row: PhaseRow): Phase {
  return {
    uuid: row.uuid,
    projectUuid: row.project_uuid,
    title: row.title,
    color: row.color || "indigo",
    position: Number(row.position),
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

export interface TaskRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  project_id: number;
  project_uuid: string;
  section_id: number;
  section_uuid: string;
  title: string;
  description: string | null;
  status: string;
  developer_checked_at: string | null;
  client_checked_at: string | null;
  due_date: string | null;
  priority: string;
  position: number;
  comment_count: number | string;
  created_at: string;
  updated_at: string;
}

function toCheck(row: TaskRow, prefix: "d" | "c", at: string | null): TaskCheck | null {
  const by = summaryFromPrefix(row, prefix);
  if (!by || !at) return null;
  return { checkedBy: by, checkedAt: fromSqlDateTime(at)! };
}

export function toTask(row: TaskRow): Task {
  return {
    uuid: row.uuid,
    projectUuid: row.project_uuid,
    sectionUuid: row.section_uuid,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    developerCheck: toCheck(row, "d", row.developer_checked_at),
    clientCheck: toCheck(row, "c", row.client_checked_at),
    dueDate: fromSqlDate(row.due_date),
    priority: row.priority as TaskPriority,
    assignee: summaryFromPrefix(row, "a"),
    position: Number(row.position),
    commentCount: Number(row.comment_count ?? 0),
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

export interface CommentRow extends Record<string, unknown> {
  uuid: string;
  task_uuid: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export function toComment(row: CommentRow): TaskComment {
  return {
    uuid: row.uuid,
    taskUuid: row.task_uuid,
    author: summaryFromPrefix(row, "u")!,
    body: row.body,
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

// ---------------------------------------------------------------------------
// Export templates
// ---------------------------------------------------------------------------

export interface ExportTemplateRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  is_default: unknown;
  /** JSON text (SQLite) or parsed object (mysql2). Interpreted by `parseTemplateDefinition`. */
  definition: unknown;
  created_at: string;
  updated_at: string;
}

export function toExportTemplate(row: ExportTemplateRow): ExportTemplate {
  return {
    uuid: row.uuid,
    name: row.name,
    description: row.description,
    isDefault: toBool(row.is_default),
    createdAt: fromSqlDateTime(row.created_at)!,
    updatedAt: fromSqlDateTime(row.updated_at)!,
  };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export interface ActivityRow extends Record<string, unknown> {
  uuid: string;
  project_uuid: string;
  action: string;
  subject: string;
  meta: unknown;
  created_at: string;
}

export function toActivity(row: ActivityRow): ActivityLog {
  let meta: Record<string, unknown> | null = null;
  if (row.meta !== null && row.meta !== undefined) {
    meta = typeof row.meta === "string" ? (JSON.parse(row.meta) as Record<string, unknown>) : (row.meta as Record<string, unknown>);
  }
  return {
    uuid: row.uuid,
    projectUuid: row.project_uuid,
    actor: summaryFromPrefix(row, "u")!,
    action: row.action as ActivityAction,
    subject: row.subject,
    meta,
    createdAt: fromSqlDateTime(row.created_at)!,
  };
}

// ---------------------------------------------------------------------------
// Admin audit
// ---------------------------------------------------------------------------

export interface AdminAuditRow extends Record<string, unknown> {
  uuid: string;
  action: string;
  target_type: string;
  target_uuid: string;
  subject: string;
  meta: unknown;
  created_at: string;
}

export function toAdminAudit(row: AdminAuditRow): AdminAuditEntry {
  let meta: Record<string, unknown> | null = null;
  if (row.meta !== null && row.meta !== undefined) {
    meta = typeof row.meta === "string" ? (JSON.parse(row.meta) as Record<string, unknown>) : (row.meta as Record<string, unknown>);
  }
  return {
    uuid: row.uuid,
    actor: summaryFromPrefix(row, "u")!,
    action: row.action as AdminAuditAction,
    targetType: row.target_type === "project" ? "project" : "user",
    targetUuid: row.target_uuid,
    subject: row.subject,
    meta,
    createdAt: fromSqlDateTime(row.created_at)!,
  };
}

// ---------------------------------------------------------------------------
// Error log
// ---------------------------------------------------------------------------

export interface ErrorLogRow extends Record<string, unknown> {
  uuid: string;
  source: string;
  status: number | string | null;
  code: string | null;
  message: string;
  stack: string | null;
  method: string | null;
  path: string | null;
  user_agent: string | null;
  context: unknown;
  created_at: string;
  /** Null when the actor is unknown (LEFT JOIN). */
  u_uuid: string | null;
}

function parseJsonColumn(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function toErrorLog(row: ErrorLogRow): AdminErrorLog {
  return {
    uuid: row.uuid,
    source: row.source === "web" ? "web" : "api",
    status: row.status === null || row.status === undefined ? null : Number(row.status),
    code: row.code,
    message: row.message,
    stack: row.stack,
    method: row.method,
    path: row.path,
    actor: summaryFromPrefix(row, "u"),
    userAgent: row.user_agent,
    context: parseJsonColumn(row.context),
    createdAt: fromSqlDateTime(row.created_at)!,
  };
}
