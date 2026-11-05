/**
 * Scope Checklist — shared contracts.
 *
 * These types describe the public shape of every entity exchanged between the
 * frontends (React + Vue modules) and the REST API. They intentionally mirror
 * the planned relational schema (users, projects, project_members,
 * project_invitations, checklist_sections, tasks, task_comments,
 * activity_logs, export_templates) so the backend — Node now, Laravel later —
 * can implement the same contract without frontend changes.
 *
 * Rules:
 *  - Public identifiers are `uuid` strings. Internal integer primary keys are
 *    never exposed through the API.
 *  - Timestamps are ISO-8601 strings in UTC.
 *  - Enumerations are string unions so they map to VARCHAR status columns.
 */

// ---------------------------------------------------------------------------
// Primitive aliases
// ---------------------------------------------------------------------------

/** Public identifier (UUID v4). */
export type Uuid = string;
/** ISO-8601 timestamp, UTC. */
export type IsoDateTime = string;
/** ISO-8601 calendar date (YYYY-MM-DD). */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Users & roles
// ---------------------------------------------------------------------------

export type SystemRole = "admin" | "user";

export interface User {
  uuid: Uuid;
  name: string;
  email: string;
  role: SystemRole;
  avatarUrl: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Minimal user reference embedded in other resources. */
export type UserSummary = Pick<User, "uuid" | "name" | "email" | "avatarUrl">;

// ---------------------------------------------------------------------------
// Projects & membership
// ---------------------------------------------------------------------------

export type ProjectStatus = "active" | "completed" | "archived";

export type ProjectMemberRole = "owner" | "editor" | "viewer";

export interface ProjectMember {
  uuid: Uuid;
  user: UserSummary;
  role: ProjectMemberRole;
  joinedAt: IsoDateTime;
}

export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export interface ProjectInvitation {
  uuid: Uuid;
  projectUuid: Uuid;
  /** Denormalised for invitee-facing lists (the invitee cannot read the project yet). */
  projectName: string;
  email: string;
  role: Exclude<ProjectMemberRole, "owner">;
  status: InvitationStatus;
  invitedBy: UserSummary;
  createdAt: IsoDateTime;
  respondedAt: IsoDateTime | null;
}

export interface ProjectStats {
  totalTasks: number;
  completedTasks: number;
  /** 0–100, rounded to an integer. */
  completionPercent: number;
  sectionCount: number;
  overdueTasks: number;
}

export interface Project {
  uuid: Uuid;
  name: string;
  description: string;
  owner: UserSummary;
  status: ProjectStatus;
  startDate: IsoDate | null;
  deadline: IsoDate | null;
  stats: ProjectStats;
  members: ProjectMember[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Checklist sections & tasks
// ---------------------------------------------------------------------------

/**
 * What a section represents: part of the agreed scope, or a revision raised
 * after the fact. Revisions are listed in their own block of the exported
 * document with a separate progress chart.
 */
export type SectionKind = "scope" | "revision";
export const SECTION_KINDS: readonly SectionKind[] = ["scope", "revision"];
export const SECTION_KIND_LABELS: Record<SectionKind, string> = { scope: "Scope", revision: "Revision" };

/**
 * Optional grouping for scopes and revisions inside a project. A project
 * can have none; sections with no phase sit in the ungrouped list.
 */
/** Named trays a user can pick; anything else is a custom `#rrggbb`. */
export const PHASE_COLOR_PRESETS = ["indigo", "teal", "amber", "violet", "rose"] as const;
export type PhaseColorPreset = (typeof PHASE_COLOR_PRESETS)[number];

export const PHASE_COLOR_HEX: Record<PhaseColorPreset, string> = {
  indigo: "#4f46e5",
  teal: "#0f766e",
  amber: "#b45309",
  violet: "#6d28d9",
  rose: "#be185d",
};

const PHASE_COLOR_PRESET_SET = new Set<string>(PHASE_COLOR_PRESETS);
const PHASE_COLOR_HEX_RE = /^#[0-9a-f]{6}$/i;

export function isPhaseColorPreset(value: string): value is PhaseColorPreset {
  return PHASE_COLOR_PRESET_SET.has(value);
}

/** Preset name or lowercase `#rrggbb`. `null` when the value is not a colour. */
export function normalizePhaseColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (isPhaseColorPreset(trimmed)) return trimmed;
  if (PHASE_COLOR_HEX_RE.test(trimmed)) return trimmed;
  return null;
}

export function defaultPhaseColor(position: number): PhaseColorPreset {
  const count = PHASE_COLOR_PRESETS.length;
  return PHASE_COLOR_PRESETS[((position % count) + count) % count]!;
}

export function phaseColorHex(color: string): string {
  if (isPhaseColorPreset(color)) return PHASE_COLOR_HEX[color];
  return PHASE_COLOR_HEX_RE.test(color) ? color.toLowerCase() : PHASE_COLOR_HEX.indigo;
}

export interface Phase {
  uuid: Uuid;
  projectUuid: Uuid;
  title: string;
  /** Zero-based ordering among the project's phases. */
  position: number;
  /** Preset name (`indigo`, `teal`, …) or a custom `#rrggbb`. */
  color: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** One heading on the project page / export: a named phase, or the ungrouped tail. */
export interface PhaseGroup<S = ChecklistSection> {
  phase: Phase | null;
  sections: S[];
}

/**
 * Phases in stored order (including empty ones), then ungrouped sections.
 * When the project has no phases, returns a single ungrouped list.
 */
export function groupSectionsByPhase<S extends { phaseUuid: Uuid | null; position: number }>(sections: S[], phases: Phase[]): PhaseGroup<S>[] {
  const sorted = [...sections].sort((a, b) => a.position - b.position || 0);
  if (phases.length === 0) return [{ phase: null, sections: sorted }];

  const byPhase = new Map<string, S[]>();
  const ungrouped: S[] = [];
  for (const section of sorted) {
    if (section.phaseUuid) {
      const list = byPhase.get(section.phaseUuid) ?? [];
      list.push(section);
      byPhase.set(section.phaseUuid, list);
    } else {
      ungrouped.push(section);
    }
  }

  const ordered = [...phases].sort((a, b) => a.position - b.position);
  const groups: PhaseGroup<S>[] = ordered.map((phase) => ({ phase, sections: byPhase.get(phase.uuid) ?? [] }));
  if (ungrouped.length > 0) groups.push({ phase: null, sections: ungrouped });
  return groups;
}

/** Scope / revision titles wrap in the editor. Keep in sync with `checklist_sections.title`. */
export const SECTION_TITLE_MAX_LENGTH = 500;

export const SECTION_REFERENCE_KINDS = ["note", "link"] as const;
export type SectionReferenceKind = (typeof SECTION_REFERENCE_KINDS)[number];

export const SECTION_NOTE_MAX_LENGTH = 2000;
export const SECTION_LINK_MAX_LENGTH = 2000;
export const SECTION_LINK_TITLE_MAX_LENGTH = 160;

export interface SectionReference {
  uuid: Uuid;
  sectionUuid: Uuid;
  kind: SectionReferenceKind;
  /** Note text, or the URL for a link. */
  body: string;
  /** Optional display label for a link. Always null on notes. */
  title: string | null;
  author: UserSummary;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateSectionReferenceInput {
  kind: SectionReferenceKind;
  body: string;
  title?: string | null;
}

/** Accepts a full http(s) URL, or a host that we prefix with https://. */
export function normalizeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sectionReferenceSummary(refs: readonly Pick<SectionReference, "kind">[]): string | null {
  let notes = 0;
  let links = 0;
  for (const ref of refs) {
    if (ref.kind === "note") notes += 1;
    else links += 1;
  }
  if (notes === 0 && links === 0) return null;
  const parts: string[] = [];
  if (notes > 0) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
  if (links > 0) parts.push(`${links} link${links === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export interface ChecklistSection {
  uuid: Uuid;
  projectUuid: Uuid;
  title: string;
  description: string | null;
  kind: SectionKind;
  /** Notes and links attached after the scope or revision was created. */
  references: SectionReference[];
  /** Optional phase this scope or revision belongs to. */
  phaseUuid: Uuid | null;
  /** Zero-based ordering inside the project. */
  position: number;
  /**
   * When the section reached 100% (every task resolved); null while anything is
   * still open or the section is empty. Stamped by the server and cleared again
   * if a task is reopened or added, so it always describes the current state.
   */
  completedAt: IsoDateTime | null;
  /**
   * Calendar date the user set for a revision ("Revision as of …").
   * Independent of `completedAt`. Null on scopes and on undated revisions.
   */
  revisionDate: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * Instant or calendar date shown as "Revision as of …". The picked date wins;
 * a finished revision without one still uses its completion day.
 */
export function revisionAsOf(section: Pick<ChecklistSection, "kind" | "revisionDate" | "completedAt">): string | null {
  if (section.kind !== "revision") return null;
  return section.revisionDate ?? section.completedAt ?? null;
}

export type TaskPriority = "low" | "medium" | "high";

/**
 * Task "remarks" status, picked from a fixed list. Order matches the
 * delivery workflow and is the order shown in pickers and legends.
 * Stored as VARCHAR; labels live in the frontend (`lib/taskStatus.ts`).
 */
export type TaskStatus =
  | "not_started"
  | "in_development"
  | "for_qa"
  | "for_revision"
  | "done_for_production"
  | "for_user_acceptance"
  | "done"
  | "for_beta_testing"
  | "completed"
  | "on_hold"
  | "not_applicable";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "not_started",
  "in_development",
  "for_qa",
  "for_revision",
  "done_for_production",
  "for_user_acceptance",
  "done",
  "for_beta_testing",
  "completed",
  "on_hold",
  "not_applicable",
];

/** Statuses that count as resolved for progress and "Done" filters. */
export const RESOLVED_TASK_STATUSES: readonly TaskStatus[] = ["done_for_production", "done", "completed", "not_applicable"];

/** Human-readable status labels — shared by the UI chips and the exported document's "Remarks" column. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: "Task Not Yet Started",
  in_development: "In Development",
  for_qa: "For QA",
  for_revision: "For Revision",
  done_for_production: "Done (For Production)",
  for_user_acceptance: "For User Acceptance",
  done: "Done",
  for_beta_testing: "For Beta Testing",
  completed: "Completed",
  on_hold: "On-Hold",
  not_applicable: "Not Applicable",
};

/** Which party ticked the "Checked by" box. */
export type TaskCheckSide = "developer" | "client";

/** A recorded tick: who checked and when. Null when unchecked. */
export interface TaskCheck {
  checkedBy: UserSummary;
  checkedAt: IsoDateTime;
}

export interface Task {
  uuid: Uuid;
  projectUuid: Uuid;
  sectionUuid: Uuid;
  title: string;
  description: string | null;
  status: TaskStatus;
  developerCheck: TaskCheck | null;
  clientCheck: TaskCheck | null;
  dueDate: IsoDate | null;
  priority: TaskPriority;
  assignee: UserSummary | null;
  /** Zero-based ordering inside the section. */
  position: number;
  commentCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TaskComment {
  uuid: Uuid;
  taskUuid: Uuid;
  author: UserSummary;
  body: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export type ActivityAction =
  | "project.created"
  | "project.updated"
  | "project.status_changed"
  | "project.deleted"
  | "section.created"
  | "section.updated"
  | "section.deleted"
  /** Every task of the section became resolved. meta: { kind: SectionKind } */
  | "section.completed"
  | "section.note_added"
  | "section.link_added"
  /** meta: { kind: SectionReferenceKind } */
  | "section.reference_deleted"
  | "phase.created"
  | "phase.updated"
  | "phase.deleted"
  | "task.created"
  | "task.updated"
  /** meta: { side: TaskCheckSide } */
  | "task.checked"
  /** meta: { side: TaskCheckSide } */
  | "task.unchecked"
  /** meta: { from: TaskStatus; to: TaskStatus } */
  | "task.status_changed"
  | "task.deleted"
  | "task.assigned"
  | "comment.added"
  /** meta: { role } */
  | "member.invited"
  /** meta: { role } */
  | "member.joined"
  | "member.removed"
  | "member.left"
  /** meta: { from, to } */
  | "member.role_changed"
  | "member.invitation_declined"
  | "member.invitation_revoked"
  /** meta: { to: user name } */
  | "project.ownership_transferred"
  /** Admin restored a soft-deleted project. */
  | "project.restored"
  | "export.generated";

/** Coarse filter for the activity history; each maps to a set of actions server-side. */
export type ActivityType = "all" | "tasks" | "checks" | "comments" | "members" | "project";

export const ACTIVITY_TYPES: readonly ActivityType[] = ["all", "tasks", "checks", "comments", "members", "project"];

export interface ActivityQuery {
  project?: Uuid;
  type?: ActivityType;
  page?: number;
  perPage?: number;
}

export interface ActivityLog {
  uuid: Uuid;
  projectUuid: Uuid;
  actor: UserSummary;
  action: ActivityAction;
  /** Human-readable subject, e.g. the task title. */
  subject: string;
  /** Optional structured payload; only used when genuinely needed. */
  meta: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Export templates
// ---------------------------------------------------------------------------

export interface ExportTemplate {
  uuid: Uuid;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * Options for one export. Sections are selected by uuid in the order the
 * project defines them; omitting `sectionUuids` exports every section.
 */
export interface CreateExportInput {
  sectionUuids?: Uuid[];
  includeDescriptions?: boolean;
  /** Print the logged date, time and name under each ticked checkbox (default true). */
  includeCheckDetails?: boolean;
  /** @deprecated The document no longer has a signature area; still accepted by the API and ignored. */
  includeSignature?: boolean;
  /** Progress pie chart with the status breakdown of the exported items (default true). */
  includeChart?: boolean;
  /** Defaults to the default template. */
  templateUuid?: Uuid;
  /** IANA zone used to print "checked at" timestamps, e.g. "Asia/Manila". */
  timeZone?: string;
}

// ---------------------------------------------------------------------------
// Administration (admin role only)
// ---------------------------------------------------------------------------

/** System-wide counters for the admin overview. Computed in SQL on request. */
export interface AdminStats {
  users: {
    total: number;
    admins: number;
    disabled: number;
    /** Registered but not yet approved — cannot sign in. */
    pending: number;
    /** Accounts created in the last 30 days. */
    newLast30Days: number;
    /** Distinct accounts with a session seen in the last 7 days. */
    activeLast7Days: number;
  };
  projects: {
    total: number;
    active: number;
    completed: number;
    archived: number;
    /** Soft-deleted projects (restorable). */
    deleted: number;
    /** Active projects whose deadline has passed. */
    overdue: number;
  };
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    byStatus: Record<TaskStatus, number>;
  };
  collaboration: {
    memberships: number;
    pendingInvitations: number;
    comments: number;
  };
  exports: {
    total: number;
    last30Days: number;
  };
  activity: {
    last7Days: number;
  };
  errors: {
    total: number;
    last24Hours: number;
    last7Days: number;
  };
  generatedAt: IsoDateTime;
}

/** A user as seen in the admin directory. */
export interface AdminUser extends User {
  /** Set when an administrator approved a self-registered account. Null while waiting. */
  approvedAt: IsoDateTime | null;
  /** Set when an administrator disabled the account; disabled users cannot sign in. */
  disabledAt: IsoDateTime | null;
  /** Most recent session activity, if any session is still stored. */
  lastSeenAt: IsoDateTime | null;
  ownedProjects: number;
  /** Project memberships of any role (owner included). */
  memberships: number;
}

export type AdminUserStatusFilter = "all" | "active" | "pending" | "disabled";
export type AdminUserRoleFilter = "all" | SystemRole;

export interface AdminUserQuery {
  /** Matches name or e-mail. */
  search?: string;
  role?: AdminUserRoleFilter;
  status?: AdminUserStatusFilter;
  page?: number;
  perPage?: number;
}

/** Name, e-mail and system role; each field optional. */
export interface AdminUpdateUserInput {
  name?: string;
  email?: string;
  role?: SystemRole;
}

/** Administrator sets a new password for any account, including their own. */
export interface AdminSetPasswordInput {
  password: string;
}

/** A project in the admin registry, including soft-deleted ones. */
export interface AdminProject extends Project {
  deletedAt: IsoDateTime | null;
}

export type AdminProjectStatusFilter = "all" | ProjectStatus | "deleted";

export interface AdminProjectQuery {
  /** Matches project name or owner name. */
  search?: string;
  /** `all` lists live projects of every status; `deleted` lists soft-deleted ones. */
  status?: AdminProjectStatusFilter;
  page?: number;
  perPage?: number;
}

/** Administrative actions recorded outside the project activity log. */
export type AdminAuditAction =
  | "user.updated"
  /** meta: { from: SystemRole; to: SystemRole } */
  | "user.role_changed"
  | "user.disabled"
  | "user.enabled"
  | "user.approved"
  | "user.sessions_revoked"
  | "user.password_reset_sent"
  | "user.password_changed"
  | "project.restored";

export interface AdminAuditEntry {
  uuid: Uuid;
  actor: UserSummary;
  action: AdminAuditAction;
  targetType: "user" | "project";
  /** Public identifier of the affected user or project. */
  targetUuid: Uuid;
  /** Human-readable subject, e.g. the user's name or the project name. */
  subject: string;
  meta: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

export interface PageQuery {
  page?: number;
  perPage?: number;
}

// ---- error logs -------------------------------------------------------------

/** Where an error was caught: the API's error handler or the web app's error boundary / window handlers. */
export type ErrorLogSource = "api" | "web";

/**
 * One recorded failure. Append-only; the stack trace and request details are
 * for administrators only and are never returned to the user who hit the error.
 */
export interface AdminErrorLog {
  uuid: Uuid;
  source: ErrorLogSource;
  /** HTTP status the API answered with (api) or null (web). */
  status: number | null;
  /** Envelope error code (api) or the error class name (web). */
  code: string | null;
  message: string;
  stack: string | null;
  /** Request method and path (api) or the page URL path (web). */
  method: string | null;
  path: string | null;
  /** Signed-in user at the time, when known. */
  actor: UserSummary | null;
  userAgent: string | null;
  context: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

export type AdminErrorSourceFilter = "all" | ErrorLogSource;

export interface AdminErrorQuery extends PageQuery {
  source?: AdminErrorSourceFilter;
  /** Matches message, code or path. */
  search?: string;
}

/** What the web app sends when its error boundary or a window handler catches something. */
export interface ClientErrorReport {
  message: string;
  /** Error class name, e.g. `TypeError`. */
  name?: string;
  stack?: string;
  /** Page path at the time. */
  path?: string;
  context?: Record<string, unknown>;
}

// ---- productivity -----------------------------------------------------------

/** Look-back window for the productivity report. */
export type AdminProductivityPeriod = "7d" | "30d" | "90d" | "all";

export const ADMIN_PRODUCTIVITY_PERIODS: readonly AdminProductivityPeriod[] = ["7d", "30d", "90d", "all"];

export interface AdminProductivityQuery {
  /** Defaults to `30d`. */
  period?: AdminProductivityPeriod;
}

/**
 * Default points awarded per recorded action when ranking users. Finishing
 * work counts most; housekeeping counts least. Deployments may override any
 * weight (API `PRODUCTIVITY_WEIGHTS`); the weights actually used are returned
 * with every `AdminProductivity` response so the UI legend matches the numbers.
 */
export const PRODUCTIVITY_WEIGHTS = {
  /** `task.status_changed` into a resolved status. */
  tasksCompleted: 5,
  /** `task.checked` (developer or client tick). */
  tasksChecked: 3,
  /** `task.created`. */
  tasksCreated: 2,
  /** `task.updated`, `task.assigned`, `task.unchecked`, status changes into an unresolved status. */
  tasksUpdated: 1,
  /** `comment.added`. */
  comments: 1,
  /** `export.generated`. */
  exports: 1,
  /** Project, section and membership events. */
  other: 1,
} as const;

export type ProductivityBucket = keyof typeof PRODUCTIVITY_WEIGHTS;
export const PRODUCTIVITY_BUCKETS = Object.keys(PRODUCTIVITY_WEIGHTS) as readonly ProductivityBucket[];
/** Points per bucket — the defaults above or a deployment's override. */
export type ProductivityWeights = Record<ProductivityBucket, number>;

/** One account's contribution over the period, derived from the project activity log. */
export interface AdminProductivityEntry {
  user: UserSummary;
  /** Disabled accounts are listed (their history is real) but flagged. */
  disabled: boolean;
  counts: Record<ProductivityBucket, number>;
  /** Every recorded action in the period. */
  totalActions: number;
  /** Weighted sum of `counts` using the response's `weights`. */
  score: number;
  /** Distinct calendar days with at least one action. */
  activeDays: number;
  /** Distinct projects touched. */
  projects: number;
  lastActiveAt: IsoDateTime | null;
}

export interface AdminProductivity {
  period: AdminProductivityPeriod;
  /** Start of the window; null for `all`. */
  since: IsoDateTime | null;
  /** Every non-deleted account, ranked by score (then total actions, then name). Zero-activity accounts come last. */
  entries: AdminProductivityEntry[];
  totals: { actions: number; score: number; activeUsers: number };
  /** The weights the scores were computed with (defaults unless the deployment tuned them). */
  weights: ProductivityWeights;
  generatedAt: IsoDateTime;
}

/** Points for a set of counts — the single place the ranking formula lives. */
export function productivityScore(counts: Record<ProductivityBucket, number>, weights: ProductivityWeights = PRODUCTIVITY_WEIGHTS): number {
  return PRODUCTIVITY_BUCKETS.reduce((sum, key) => sum + counts[key] * weights[key], 0);
}

/**
 * Parse a weight override such as `tasksCompleted=8,comments=2`. Unlisted
 * buckets keep their defaults. Throws on unknown buckets or values that are
 * not non-negative integers so a typo is caught at start-up, not in a report.
 */
export function parseProductivityWeights(raw: string | undefined, defaults: ProductivityWeights = PRODUCTIVITY_WEIGHTS): ProductivityWeights {
  const weights: ProductivityWeights = { ...defaults };
  const text = raw?.trim();
  if (!text) return weights;
  for (const pair of text.split(",")) {
    const [key, value, ...rest] = pair.split("=").map((s) => s.trim());
    if (!key || value === undefined || rest.length > 0) throw new Error(`PRODUCTIVITY_WEIGHTS: expected "bucket=points" but got "${pair.trim()}".`);
    if (!PRODUCTIVITY_BUCKETS.includes(key as ProductivityBucket)) throw new Error(`PRODUCTIVITY_WEIGHTS: unknown bucket "${key}". Known: ${PRODUCTIVITY_BUCKETS.join(", ")}.`);
    if (!/^\d+$/.test(value)) throw new Error(`PRODUCTIVITY_WEIGHTS: "${key}" must be a non-negative whole number, got "${value}".`);
    weights[key as ProductivityBucket] = Number(value);
  }
  return weights;
}

/** Which bucket an activity action lands in. `meta.to` decides between completed and updated for status changes. */
export function productivityBucket(action: ActivityAction, meta: Record<string, unknown> | null): ProductivityBucket {
  switch (action) {
    case "task.status_changed":
      return RESOLVED_TASK_STATUSES.includes(meta?.to as TaskStatus) ? "tasksCompleted" : "tasksUpdated";
    case "task.checked":
      return "tasksChecked";
    case "task.created":
      return "tasksCreated";
    case "task.updated":
    case "task.assigned":
    case "task.unchecked":
      return "tasksUpdated";
    case "comment.added":
    case "section.note_added":
    case "section.link_added":
      return "comments";
    case "export.generated":
      return "exports";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export interface ApiMeta {
  requestId?: string;
  /** Present on paged list responses (`data` is then one page of items). */
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: ApiFieldError[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Request payloads (used by both frontends and validated by the backend)
// ---------------------------------------------------------------------------

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

/** Outcome of self-registration. `pendingApproval` means no session was opened. */
export interface RegisterResult {
  user: User;
  pendingApproval: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ResetPasswordInput {
  /** Single-use token from the e-mailed link. */
  token: string;
  password: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  startDate?: IsoDate | null;
  deadline?: IsoDate | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput> & {
  status?: ProjectStatus;
};

export interface CreateSectionInput {
  title: string;
  description?: string | null;
  /** Defaults to `scope`. */
  kind?: SectionKind;
  /** Optional phase to place the section in. */
  phaseUuid?: Uuid | null;
  /** Calendar date for a revision. Ignored for scopes unless stored for later. */
  revisionDate?: IsoDate | null;
  /** Optional note or link saved with the new scope or revision. */
  reference?: CreateSectionReferenceInput | null;
}

export type UpdateSectionInput = Partial<Omit<CreateSectionInput, "reference">>;

export interface ReorderSectionsInput {
  /** Section uuids in their new order. */
  orderedSectionUuids: Uuid[];
}

export interface CreatePhaseInput {
  title: string;
  /** Omit to assign the next preset in order. */
  color?: string;
}

export interface UpdatePhaseInput {
  title?: string;
  color?: string;
}

export interface ReorderPhasesInput {
  orderedPhaseUuids: Uuid[];
}

export interface CreateTaskInput {
  sectionUuid: Uuid;
  title: string;
  description?: string | null;
  dueDate?: IsoDate | null;
  priority?: TaskPriority;
  assigneeUuid?: Uuid | null;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, "sectionUuid">> & {
  sectionUuid?: Uuid;
  status?: TaskStatus;
  /**
   * Tick or clear a "Checked by" box. The server records the acting user and
   * timestamp; clients never send `checkedBy`/`checkedAt`.
   */
  developerChecked?: boolean;
  clientChecked?: boolean;
};

export interface ReorderTasksInput {
  sectionUuid: Uuid;
  /** Task uuids in their new order. */
  orderedTaskUuids: Uuid[];
}

export interface InviteMemberInput {
  email: string;
  role: Exclude<ProjectMemberRole, "owner">;
}

export interface UpdateMemberRoleInput {
  role: Exclude<ProjectMemberRole, "owner">;
}

export interface TransferOwnershipInput {
  /** `ProjectMember.uuid` of the member who becomes the owner. */
  memberUuid: Uuid;
}

export interface AcceptInvitationByTokenInput {
  token: string;
}
