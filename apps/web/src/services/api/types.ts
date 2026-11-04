import type {
  ActivityLog,
  ActivityQuery,
  AdminAuditEntry,
  AdminErrorLog,
  AdminErrorQuery,
  AdminProject,
  AdminProjectQuery,
  AdminStats,
  AdminProductivity,
  AdminProductivityQuery,
  AdminSetPasswordInput,
  AdminUpdateUserInput,
  AdminUser,
  AdminUserQuery,
  ChangePasswordInput,
  ChecklistSection,
  ClientErrorReport,
  CreateExportInput,
  CreatePhaseInput,
  CreateProjectInput,
  CreateSectionInput,
  CreateTaskInput,
  ExportTemplate,
  InviteMemberInput,
  LoginInput,
  PageQuery,
  Paginated,
  Phase,
  Project,
  ProjectInvitation,
  ProjectMemberRole,
  RegisterInput,
  RegisterResult,
  ReorderPhasesInput,
  ReorderSectionsInput,
  ReorderTasksInput,
  ResetPasswordInput,
  Task,
  TaskComment,
  UpdatePhaseInput,
  UpdateProfileInput,
  UpdateProjectInput,
  UpdateSectionInput,
  UpdateTaskInput,
  User,
  Uuid,
} from "@scope/contracts";

/** A generated document as returned by the export endpoint. */
export interface ExportedFile {
  blob: Blob;
  fileName: string;
  /** Name of the template that produced it. */
  template: string;
  sectionCount: number;
  taskCount: number;
}

/**
 * The API service contract consumed by the store (and therefore by every
 * React and Vue component). Two implementations exist with the same
 * signature: the in-memory mock (Phase 1) and the HTTP client (Phase 2).
 */
export interface ScopeApi {
  // ---- auth -------------------------------------------------------------
  /** Resolves `null` when no session exists (never throws for 401). */
  getCurrentUser(): Promise<User | null>;
  register(input: RegisterInput): Promise<RegisterResult>;
  login(input: LoginInput): Promise<User>;
  logout(): Promise<void>;
  updateProfile(input: UpdateProfileInput): Promise<User>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  /** Always resolves, whether or not the e-mail exists (prevents enumeration). */
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: ResetPasswordInput): Promise<void>;

  // ---- reads ------------------------------------------------------------
  listProjects(): Promise<Project[]>;
  getProject(uuid: Uuid): Promise<Project>;
  listSections(projectUuid: Uuid): Promise<ChecklistSection[]>;
  listPhases(projectUuid: Uuid): Promise<Phase[]>;
  listTasks(projectUuid: Uuid): Promise<Task[]>;
  listComments(taskUuid: Uuid): Promise<TaskComment[]>;
  listActivity(projectUuid?: Uuid): Promise<ActivityLog[]>;
  /** Server-side paged history with coarse type filter (Phase 4). */
  listActivityPage(query: ActivityQuery): Promise<Paginated<ActivityLog>>;

  // ---- membership & invitations (Phase 4) --------------------------------
  /** Pending + answered invitations of a project; owner/admin only. */
  listProjectInvitations(projectUuid: Uuid): Promise<ProjectInvitation[]>;
  inviteMember(projectUuid: Uuid, input: InviteMemberInput): Promise<ProjectInvitation>;
  revokeInvitation(projectUuid: Uuid, invitationUuid: Uuid): Promise<ProjectInvitation>;
  /** Membership mutations resolve the refreshed project (members list included). */
  updateMemberRole(projectUuid: Uuid, memberUuid: Uuid, role: Exclude<ProjectMemberRole, "owner">): Promise<Project>;
  removeMember(projectUuid: Uuid, memberUuid: Uuid): Promise<Project>;
  transferOwnership(projectUuid: Uuid, memberUuid: Uuid): Promise<Project>;
  leaveProject(projectUuid: Uuid): Promise<void>;
  /** Pending invitations addressed to the signed-in user. */
  listMyInvitations(): Promise<ProjectInvitation[]>;
  acceptInvitation(invitationUuid: Uuid): Promise<Project>;
  acceptInvitationByToken(token: string): Promise<Project>;
  declineInvitation(invitationUuid: Uuid): Promise<void>;

  // ---- export (Phase 5) -------------------------------------------------
  listExportTemplates(): Promise<ExportTemplate[]>;
  /** Generates the DOCX server-side; any member may export. Logs `export.generated`. */
  exportProject(projectUuid: Uuid, input: CreateExportInput): Promise<ExportedFile>;

  // ---- administration (Phase 6; admin role only, 403 otherwise) -----------
  adminStats(): Promise<AdminStats>;
  /** Accounts ranked by weighted activity over a look-back window. */
  adminProductivity(query: AdminProductivityQuery): Promise<AdminProductivity>;
  adminListUsers(query: AdminUserQuery): Promise<Paginated<AdminUser>>;
  adminUpdateUser(userUuid: Uuid, input: AdminUpdateUserInput): Promise<AdminUser>;
  /** Disabled accounts keep their data but cannot sign in; their sessions are revoked. */
  adminSetUserDisabled(userUuid: Uuid, disabled: boolean): Promise<AdminUser>;
  /** Allow a self-registered account to sign in. */
  adminApproveUser(userUuid: Uuid): Promise<AdminUser>;
  adminRevokeUserSessions(userUuid: Uuid): Promise<void>;
  adminSendPasswordReset(userUuid: Uuid): Promise<void>;
  /** Sets a new password for any account, including the administrator's own. */
  adminSetUserPassword(userUuid: Uuid, input: AdminSetPasswordInput): Promise<void>;
  adminListProjects(query: AdminProjectQuery): Promise<Paginated<AdminProject>>;
  adminRestoreProject(projectUuid: Uuid): Promise<AdminProject>;
  adminListAudit(query: PageQuery): Promise<Paginated<AdminAuditEntry>>;
  /** Unhandled API failures and reported client crashes, newest first. */
  adminListErrors(query: AdminErrorQuery): Promise<Paginated<AdminErrorLog>>;
  adminGetError(errorUuid: Uuid): Promise<AdminErrorLog>;
  /** Fire-and-forget crash report from the web app; works signed out too. */
  reportError(report: ClientErrorReport): Promise<void>;

  // ---- writes -----------------------------------------------------------
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectUuid: Uuid, input: UpdateProjectInput): Promise<Project>;
  /** Soft delete; the project disappears from every list but history is retained server-side. */
  deleteProject(projectUuid: Uuid): Promise<void>;
  createSection(projectUuid: Uuid, input: CreateSectionInput): Promise<ChecklistSection>;
  updateSection(sectionUuid: Uuid, input: UpdateSectionInput): Promise<ChecklistSection>;
  /** Removes the section and every task in it. Rejected (409) for the last section of a project. */
  deleteSection(sectionUuid: Uuid): Promise<void>;
  reorderSections(projectUuid: Uuid, input: ReorderSectionsInput): Promise<ChecklistSection[]>;
  createPhase(projectUuid: Uuid, input: CreatePhaseInput): Promise<Phase>;
  updatePhase(phaseUuid: Uuid, input: UpdatePhaseInput): Promise<Phase>;
  /** Ungroups scopes and revisions; does not delete them. */
  deletePhase(phaseUuid: Uuid): Promise<void>;
  reorderPhases(projectUuid: Uuid, input: ReorderPhasesInput): Promise<Phase[]>;
  createTask(projectUuid: Uuid, input: CreateTaskInput): Promise<Task>;
  updateTask(taskUuid: Uuid, input: UpdateTaskInput): Promise<Task>;
  deleteTask(taskUuid: Uuid): Promise<void>;
  reorderTasks(projectUuid: Uuid, input: ReorderTasksInput): Promise<Task[]>;
  addComment(taskUuid: Uuid, body: string): Promise<TaskComment>;
}
