import { create } from "zustand";
import type {
  ActivityLog,
  ChangePasswordInput,
  ChecklistSection,
  CreateExportInput,
  CreateProjectInput,
  CreateSectionReferenceInput,
  BulkUpdateTaskStatusInput,
  CreateTaskInput,
  Phase,
  ExportTemplate,
  InviteMemberInput,
  IsoDate,
  LoginInput,
  Project,
  ProjectInvitation,
  ProjectMemberRole,
  RegisterInput,
  RegisterResult,
  SectionKind,
  Task,
  TaskCheckSide,
  TaskComment,
  TaskStatus,
  UpdateProfileInput,
  UpdateProjectInput,
  UpdateSectionInput,
  UpdateTaskInput,
  User,
  UserSummary,
  Uuid,
} from "@scope/contracts";
import { api, onUnauthorized, type ExportedFile } from "@/services/api";
import { externalAuth } from "@/services/auth/externalAuth";
import { computeStats } from "@/lib/stats";
import { isResolved } from "@/lib/taskStatus";

/**
 * Application state. Holds normalized server data plus loading flags.
 * Mutations are optimistic: the UI updates immediately, the API call follows,
 * and the server result reconciles the local copy.
 */

type LoadState = "idle" | "loading" | "ready" | "error";
/** `unauthenticated` means the server answered but there is no session. */
export type BootState = LoadState | "unauthenticated";

interface AppState {
  currentUser: User | null;
  bootState: BootState;

  projects: Project[];
  /** Per project: sections, tasks and load state. */
  sectionsByProject: Record<Uuid, ChecklistSection[]>;
  phasesByProject: Record<Uuid, Phase[]>;
  tasksByProject: Record<Uuid, Task[]>;
  projectLoadState: Record<Uuid, LoadState>;

  commentsByTask: Record<Uuid, TaskComment[]>;
  activities: ActivityLog[];
  activityState: LoadState;

  /** Project currently in focus (drives the sidebar switcher). */
  activeProjectUuid: Uuid | null;

  /** Invitations sent from a project (owner/admin view) and the ones addressed to me. */
  invitationsByProject: Record<Uuid, ProjectInvitation[]>;
  myInvitations: ProjectInvitation[];
  myInvitationsState: LoadState;

  /** Document templates (reference data; loaded once). */
  exportTemplates: ExportTemplate[];
  exportTemplatesState: LoadState;

  // Auth
  bootstrap(): Promise<void>;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<RegisterResult>;
  logout(): Promise<void>;
  updateProfile(input: UpdateProfileInput): Promise<void>;
  changePassword(input: ChangePasswordInput): Promise<void>;
  /** Drop every cached resource (after sign-out or a lost session). */
  resetSession(): void;

  // Data
  loadProject(projectUuid: Uuid): Promise<void>;
  loadActivity(): Promise<void>;
  /** Re-fetch activity after a mutation that the server logs (no-op until first load). */
  refreshActivity(): Promise<void>;
  loadComments(taskUuid: Uuid): Promise<void>;
  setActiveProject(projectUuid: Uuid | null): void;

  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(projectUuid: Uuid, input: UpdateProjectInput): Promise<Project>;
  /** Soft delete on the server; locally the project and its cached data are dropped. */
  deleteProject(projectUuid: Uuid): Promise<void>;
  /** Insert or replace a project the server handed back outside the normal flows (e.g. an admin restore). */
  upsertProject(project: Project): void;
  /** Apply a server-side account change (e.g. an admin renamed the signed-in user). */
  patchCurrentUser(patch: Partial<User>): void;
  updateSection(sectionUuid: Uuid, input: UpdateSectionInput): Promise<void>;
  deleteSection(sectionUuid: Uuid): Promise<void>;
  reorderSections(projectUuid: Uuid, orderedSectionUuids: Uuid[]): Promise<void>;
  /** Tick or clear the Developer / Client "Checked by" box. */
  toggleCheck(taskUuid: Uuid, side: TaskCheckSide): Promise<void>;
  setTaskStatus(taskUuid: Uuid, status: TaskStatus): Promise<void>;
  bulkSetTaskStatus(projectUuid: Uuid, input: BulkUpdateTaskStatusInput): Promise<void>;
  updateTask(taskUuid: Uuid, input: UpdateTaskInput): Promise<void>;
  createTask(projectUuid: Uuid, input: CreateTaskInput): Promise<Task>;
  deleteTask(taskUuid: Uuid): Promise<void>;
  reorderTasks(projectUuid: Uuid, sectionUuid: Uuid, orderedTaskUuids: Uuid[]): Promise<void>;
  createSection(projectUuid: Uuid, title: string, kind?: SectionKind, phaseUuid?: Uuid | null, revisionDate?: IsoDate | null, reference?: CreateSectionReferenceInput | null): Promise<ChecklistSection>;
  createPhase(projectUuid: Uuid, title: string, color?: string): Promise<Phase>;
  updatePhase(phaseUuid: Uuid, input: { title?: string; color?: string }): Promise<void>;
  deletePhase(phaseUuid: Uuid): Promise<void>;
  reorderPhases(projectUuid: Uuid, orderedPhaseUuids: Uuid[]): Promise<void>;
  addComment(taskUuid: Uuid, body: string): Promise<void>;
  addSectionReference(sectionUuid: Uuid, input: CreateSectionReferenceInput): Promise<void>;
  deleteSectionReference(sectionUuid: Uuid, referenceUuid: Uuid): Promise<void>;
  /** Re-read the project's sections when a task change moved one across the 100% line (picks up the server's `completedAt` stamp). */
  syncSectionCompletion(projectUuid: Uuid): Promise<void>;

  // Membership & invitations
  loadProjectInvitations(projectUuid: Uuid): Promise<void>;
  inviteMember(projectUuid: Uuid, input: InviteMemberInput): Promise<ProjectInvitation>;
  revokeInvitation(projectUuid: Uuid, invitationUuid: Uuid): Promise<void>;
  updateMemberRole(projectUuid: Uuid, memberUuid: Uuid, role: Exclude<ProjectMemberRole, "owner">): Promise<void>;
  removeMember(projectUuid: Uuid, memberUuid: Uuid): Promise<void>;
  transferOwnership(projectUuid: Uuid, memberUuid: Uuid): Promise<void>;
  /** Leaves and drops the project (and its cached data) locally. */
  leaveProject(projectUuid: Uuid): Promise<void>;
  loadMyInvitations(force?: boolean): Promise<void>;
  /** Accepting adds the project to the list and returns it so the UI can navigate. */
  acceptInvitation(invitationUuid: Uuid): Promise<Project>;
  acceptInvitationByToken(token: string): Promise<Project>;
  declineInvitation(invitationUuid: Uuid): Promise<void>;

  // Export
  loadExportTemplates(): Promise<void>;
  /** Generates the document server-side and returns it; the caller decides how to save it. */
  exportProject(projectUuid: Uuid, input: CreateExportInput): Promise<ExportedFile>;
}

const toSummary = (u: User): UserSummary => ({ uuid: u.uuid, name: u.name, email: u.email, avatarUrl: u.avatarUrl });

function findProjectUuidOfSection(state: AppState, sectionUuid: Uuid): Uuid | null {
  for (const [projectUuid, sections] of Object.entries(state.sectionsByProject)) {
    if (sections.some((s) => s.uuid === sectionUuid)) return projectUuid;
  }
  return null;
}

function patchSection(state: AppState, sectionUuid: Uuid, patch: (section: ChecklistSection) => ChecklistSection): Partial<AppState> {
  const projectUuid = findProjectUuidOfSection(state, sectionUuid);
  if (!projectUuid) return {};
  return {
    sectionsByProject: {
      ...state.sectionsByProject,
      [projectUuid]: state.sectionsByProject[projectUuid].map((section) => (section.uuid === sectionUuid ? patch(section) : section)),
    },
  };
}

function findProjectUuidOfTask(state: AppState, taskUuid: Uuid): Uuid | null {
  for (const [projectUuid, tasks] of Object.entries(state.tasksByProject)) {
    if (tasks.some((t) => t.uuid === taskUuid)) return projectUuid;
  }
  return null;
}

/** Recompute `project.stats` from local tasks so dashboards update instantly. */
function refreshStats(state: AppState, projectUuid: Uuid): Partial<AppState> {
  const tasks = state.tasksByProject[projectUuid] ?? [];
  const sections = state.sectionsByProject[projectUuid] ?? [];
  return {
    projects: state.projects.map((p) => (p.uuid === projectUuid ? { ...p, stats: computeStats(tasks, sections), updatedAt: new Date().toISOString() } : p)),
  };
}

/**
 * The server stamps a section's `completedAt` when its last task resolves and
 * clears it when work reopens. The cached sections only learn about that by
 * being re-read, so after a task change compare what the tasks say with the
 * stamps we hold and refresh the project's sections when they disagree.
 */
function sectionStampsStale(state: AppState, projectUuid: Uuid): boolean {
  const tasks = state.tasksByProject[projectUuid] ?? [];
  return (state.sectionsByProject[projectUuid] ?? []).some((section) => {
    const own = tasks.filter((t) => t.sectionUuid === section.uuid);
    const complete = own.length > 0 && own.every(isResolved);
    return complete !== (section.completedAt !== null);
  });
}

function patchTask(state: AppState, taskUuid: Uuid, patch: Partial<Task>): Partial<AppState> {
  const projectUuid = findProjectUuidOfTask(state, taskUuid);
  if (!projectUuid) return {};
  const tasksByProject = {
    ...state.tasksByProject,
    [projectUuid]: state.tasksByProject[projectUuid].map((t) => (t.uuid === taskUuid ? { ...t, ...patch } : t)),
  };
  return { tasksByProject, ...refreshStats({ ...state, tasksByProject }, projectUuid) };
}

const EMPTY_DATA = {
  projects: [] as Project[],
  sectionsByProject: {} as Record<Uuid, ChecklistSection[]>,
  phasesByProject: {} as Record<Uuid, Phase[]>,
  tasksByProject: {} as Record<Uuid, Task[]>,
  projectLoadState: {} as Record<Uuid, LoadState>,
  commentsByTask: {} as Record<Uuid, TaskComment[]>,
  activities: [] as ActivityLog[],
  activityState: "idle" as LoadState,
  activeProjectUuid: null as Uuid | null,
  invitationsByProject: {} as Record<Uuid, ProjectInvitation[]>,
  myInvitations: [] as ProjectInvitation[],
  myInvitationsState: "idle" as LoadState,
  exportTemplates: [] as ExportTemplate[],
  exportTemplatesState: "idle" as LoadState,
};

/** Drop a project and everything cached under it (after delete or leave). */
function forgetProject(s: AppState, projectUuid: Uuid): Partial<AppState> {
  const projects = s.projects.filter((p) => p.uuid !== projectUuid);
  const { [projectUuid]: _sections, ...sectionsByProject } = s.sectionsByProject;
  const { [projectUuid]: _phases, ...phasesByProject } = s.phasesByProject;
  const { [projectUuid]: _tasks, ...tasksByProject } = s.tasksByProject;
  const { [projectUuid]: _load, ...projectLoadState } = s.projectLoadState;
  const { [projectUuid]: _invites, ...invitationsByProject } = s.invitationsByProject;
  void _sections;
  void _phases;
  void _tasks;
  void _load;
  void _invites;
  const activeProjectUuid = s.activeProjectUuid === projectUuid ? (projects.find((p) => p.status === "active") ?? projects[0])?.uuid ?? null : s.activeProjectUuid;
  return {
    projects,
    sectionsByProject,
    phasesByProject,
    tasksByProject,
    projectLoadState,
    invitationsByProject,
    activeProjectUuid,
    activities: s.activities.filter((a) => a.projectUuid !== projectUuid),
  };
}

/** Replace one project in the list with the server's refreshed copy. */
function replaceProject(s: AppState, project: Project): Partial<AppState> {
  return { projects: s.projects.map((p) => (p.uuid === project.uuid ? project : p)) };
}

export const useAppStore = create<AppState>()((set, get) => ({
  currentUser: null,
  bootState: "idle",
  ...EMPTY_DATA,

  async bootstrap() {
    if (get().bootState !== "idle") return;
    set({ bootState: "loading" });
    try {
      const currentUser = await api.getCurrentUser();
      if (!currentUser) {
        set({ currentUser: null, bootState: "unauthenticated" });
        return;
      }
      const projects = await api.listProjects();
      const firstActive = projects.find((p) => p.status === "active") ?? projects[0] ?? null;
      set((s) => ({
        currentUser,
        projects,
        bootState: "ready",
        activeProjectUuid: s.activeProjectUuid ?? firstActive?.uuid ?? null,
      }));
    } catch {
      set({ bootState: "error" });
    }
  },

  async login(input) {
    const currentUser = await api.login(input);
    const projects = await api.listProjects();
    const firstActive = projects.find((p) => p.status === "active") ?? projects[0] ?? null;
    set({ ...EMPTY_DATA, currentUser, projects, bootState: "ready", activeProjectUuid: firstActive?.uuid ?? null });
  },

  async register(input) {
    const result = await api.register(input);
    if (!result.pendingApproval) {
      set({ ...EMPTY_DATA, currentUser: result.user, bootState: "ready" });
    }
    return result;
  },

  async logout() {
    try {
      await api.logout();
      // Under Clerk the browser session must end at the provider too, or the next request would sign back in.
      await externalAuth.get().signOut();
    } finally {
      get().resetSession();
    }
  },

  async updateProfile(input) {
    const currentUser = await api.updateProfile(input);
    set({ currentUser });
  },

  async changePassword(input) {
    await api.changePassword(input);
  },

  resetSession() {
    set({ ...EMPTY_DATA, currentUser: null, bootState: "unauthenticated" });
  },

  async loadProject(projectUuid) {
    const current = get().projectLoadState[projectUuid];
    if (current === "loading" || current === "ready") return;
    set((s) => ({ projectLoadState: { ...s.projectLoadState, [projectUuid]: "loading" } }));
    try {
      const [sections, tasks, phases] = await Promise.all([api.listSections(projectUuid), api.listTasks(projectUuid), api.listPhases(projectUuid)]);
      set((s) => ({
        sectionsByProject: { ...s.sectionsByProject, [projectUuid]: sections },
        tasksByProject: { ...s.tasksByProject, [projectUuid]: tasks },
        phasesByProject: { ...s.phasesByProject, [projectUuid]: phases },
        projectLoadState: { ...s.projectLoadState, [projectUuid]: "ready" },
      }));
    } catch {
      set((s) => ({ projectLoadState: { ...s.projectLoadState, [projectUuid]: "error" } }));
    }
  },

  async loadActivity() {
    if (get().activityState !== "idle") return;
    set({ activityState: "loading" });
    try {
      const activities = await api.listActivity();
      set({ activities, activityState: "ready" });
    } catch {
      set({ activityState: "error" });
    }
  },

  async loadComments(taskUuid) {
    if (get().commentsByTask[taskUuid]) return;
    const comments = await api.listComments(taskUuid);
    set((s) => ({ commentsByTask: { ...s.commentsByTask, [taskUuid]: comments } }));
  },

  setActiveProject(projectUuid) {
    set({ activeProjectUuid: projectUuid });
  },

  async createProject(input) {
    const project = await api.createProject(input);
    set((s) => ({ projects: [project, ...s.projects], activeProjectUuid: project.uuid }));
    return project;
  },

  async updateProject(projectUuid, input) {
    const project = await api.updateProject(projectUuid, input);
    set((s) => ({ projects: s.projects.map((p) => (p.uuid === projectUuid ? project : p)) }));
    void get().refreshActivity();
    return project;
  },

  async deleteProject(projectUuid) {
    await api.deleteProject(projectUuid);
    set((s) => forgetProject(s, projectUuid));
  },

  upsertProject(project) {
    set((s) => ({ projects: s.projects.some((p) => p.uuid === project.uuid) ? s.projects.map((p) => (p.uuid === project.uuid ? project : p)) : [project, ...s.projects] }));
    void get().refreshActivity();
  },

  patchCurrentUser(patch) {
    set((s) => (s.currentUser ? { currentUser: { ...s.currentUser, ...patch } } : {}));
  },

  async updateSection(sectionUuid, input) {
    const section = await api.updateSection(sectionUuid, input);
    set((s) => ({
      sectionsByProject: {
        ...s.sectionsByProject,
        [section.projectUuid]: (s.sectionsByProject[section.projectUuid] ?? []).map((x) => (x.uuid === sectionUuid ? section : x)),
      },
    }));
    void get().refreshActivity();
  },

  async deleteSection(sectionUuid) {
    const state = get();
    const projectUuid = Object.keys(state.sectionsByProject).find((uuid) => state.sectionsByProject[uuid].some((x) => x.uuid === sectionUuid));
    await api.deleteSection(sectionUuid);
    if (!projectUuid) return;
    set((s) => {
      const sectionsByProject = { ...s.sectionsByProject, [projectUuid]: s.sectionsByProject[projectUuid].filter((x) => x.uuid !== sectionUuid) };
      const tasksByProject = { ...s.tasksByProject, [projectUuid]: (s.tasksByProject[projectUuid] ?? []).filter((t) => t.sectionUuid !== sectionUuid) };
      return { sectionsByProject, tasksByProject, ...refreshStats({ ...s, sectionsByProject, tasksByProject }, projectUuid) };
    });
    void get().refreshActivity();
  },

  async reorderSections(projectUuid, orderedSectionUuids) {
    const previous = get().sectionsByProject[projectUuid];
    set((s) => {
      const order = new Map(orderedSectionUuids.map((uuid, i) => [uuid, i]));
      const next = (s.sectionsByProject[projectUuid] ?? []).map((x) => (order.has(x.uuid) ? { ...x, position: order.get(x.uuid)! } : x)).sort((a, b) => a.position - b.position);
      return { sectionsByProject: { ...s.sectionsByProject, [projectUuid]: next } };
    });
    try {
      const sections = await api.reorderSections(projectUuid, { orderedSectionUuids });
      set((s) => ({ sectionsByProject: { ...s.sectionsByProject, [projectUuid]: sections } }));
    } catch (err) {
      if (previous) set((s) => ({ sectionsByProject: { ...s.sectionsByProject, [projectUuid]: previous } }));
      throw err;
    }
  },

  async toggleCheck(taskUuid, side) {
    const state = get();
    const projectUuid = findProjectUuidOfTask(state, taskUuid);
    if (!projectUuid || !state.currentUser) return;
    const task = state.tasksByProject[projectUuid].find((t) => t.uuid === taskUuid);
    if (!task) return;

    const field = side === "developer" ? "developerCheck" : "clientCheck";
    const previous = task[field];
    const next = previous ? null : { checkedBy: toSummary(state.currentUser), checkedAt: new Date().toISOString() };
    set((s) => patchTask(s, taskUuid, { [field]: next }));
    try {
      const saved = await api.updateTask(taskUuid, side === "developer" ? { developerChecked: next !== null } : { clientChecked: next !== null });
      set((s) => patchTask(s, taskUuid, saved));
      void get().refreshActivity();
    } catch {
      set((s) => patchTask(s, taskUuid, { [field]: previous }));
    }
  },

  async setTaskStatus(taskUuid, status) {
    const projectUuid = findProjectUuidOfTask(get(), taskUuid);
    const previous = projectUuid ? get().tasksByProject[projectUuid].find((t) => t.uuid === taskUuid)?.status : undefined;
    if (previous === undefined || previous === status) return;
    set((s) => patchTask(s, taskUuid, { status }));
    try {
      const saved = await api.updateTask(taskUuid, { status });
      set((s) => patchTask(s, taskUuid, saved));
      void get().refreshActivity();
      void get().syncSectionCompletion(projectUuid!);
    } catch {
      set((s) => patchTask(s, taskUuid, { status: previous }));
    }
  },

  async bulkSetTaskStatus(projectUuid, input) {
    const previous = get().tasksByProject[projectUuid] ?? [];
    const targets = new Set(input.taskUuids ?? previous.filter((t) => t.sectionUuid === input.sectionUuid).map((t) => t.uuid));
    if (targets.size === 0) return;
    set((s) => {
      const tasksByProject = {
        ...s.tasksByProject,
        [projectUuid]: previous.map((t) => (targets.has(t.uuid) ? { ...t, status: input.status } : t)),
      };
      return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
    });
    try {
      const saved = await api.bulkUpdateTaskStatus(projectUuid, { ...input, taskUuids: [...targets] });
      const byUuid = new Map(saved.map((t) => [t.uuid, t]));
      set((s) => {
        const tasksByProject = {
          ...s.tasksByProject,
          [projectUuid]: (s.tasksByProject[projectUuid] ?? []).map((t) => byUuid.get(t.uuid) ?? t),
        };
        return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
      });
      void get().refreshActivity();
      void get().syncSectionCompletion(projectUuid);
    } catch {
      set((s) => {
        const tasksByProject = { ...s.tasksByProject, [projectUuid]: previous };
        return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
      });
    }
  },

  async updateTask(taskUuid, input) {
    const { assigneeUuid, ...rest } = input;
    void assigneeUuid; // resolved by the API into an assignee summary
    set((s) => patchTask(s, taskUuid, { ...rest, updatedAt: new Date().toISOString() } as Partial<Task>));
    const saved = await api.updateTask(taskUuid, input);
    set((s) => patchTask(s, taskUuid, saved));
    if (input.status !== undefined || input.sectionUuid !== undefined) void get().syncSectionCompletion(saved.projectUuid);
  },

  async syncSectionCompletion(projectUuid) {
    if (!sectionStampsStale(get(), projectUuid)) return;
    try {
      const sections = await api.listSections(projectUuid);
      set((s) => ({ sectionsByProject: { ...s.sectionsByProject, [projectUuid]: sections } }));
    } catch {
      // The stamp is cosmetic here; the next full load will catch up.
    }
  },

  async refreshActivity() {
    if (get().activityState !== "ready") return;
    const activities = await api.listActivity();
    set({ activities });
  },

  async createTask(projectUuid, input) {
    const task = await api.createTask(projectUuid, input);
    set((s) => {
      const tasksByProject = { ...s.tasksByProject, [projectUuid]: [...(s.tasksByProject[projectUuid] ?? []), task] };
      return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
    });
    void get().syncSectionCompletion(projectUuid);
    return task;
  },

  async deleteTask(taskUuid) {
    const projectUuid = findProjectUuidOfTask(get(), taskUuid);
    if (!projectUuid) return;
    const previous = get().tasksByProject[projectUuid];
    set((s) => {
      const tasksByProject = { ...s.tasksByProject, [projectUuid]: previous.filter((t) => t.uuid !== taskUuid) };
      return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
    });
    try {
      await api.deleteTask(taskUuid);
      void get().syncSectionCompletion(projectUuid);
    } catch {
      set((s) => {
        const tasksByProject = { ...s.tasksByProject, [projectUuid]: previous };
        return { tasksByProject, ...refreshStats({ ...s, tasksByProject }, projectUuid) };
      });
    }
  },

  async reorderTasks(projectUuid, sectionUuid, orderedTaskUuids) {
    set((s) => {
      const tasks = s.tasksByProject[projectUuid] ?? [];
      const order = new Map(orderedTaskUuids.map((uuid, i) => [uuid, i]));
      const next = tasks.map((t) => (order.has(t.uuid) ? { ...t, sectionUuid, position: order.get(t.uuid)! } : t));
      return { tasksByProject: { ...s.tasksByProject, [projectUuid]: next } };
    });
    await api.reorderTasks(projectUuid, { sectionUuid, orderedTaskUuids });
    void get().syncSectionCompletion(projectUuid);
  },

  async createSection(projectUuid, title, kind = "scope", phaseUuid, revisionDate, reference) {
    const section = await api.createSection(projectUuid, {
      title,
      kind,
      phaseUuid: phaseUuid ?? undefined,
      revisionDate: kind === "revision" ? revisionDate ?? null : undefined,
      reference: reference ?? undefined,
    });
    set((s) => {
      const sectionsByProject = { ...s.sectionsByProject, [projectUuid]: [...(s.sectionsByProject[projectUuid] ?? []), section] };
      return { sectionsByProject, ...refreshStats({ ...s, sectionsByProject }, projectUuid) };
    });
    if (reference) void get().refreshActivity();
    return section;
  },

  async createPhase(projectUuid, title, color) {
    const phase = await api.createPhase(projectUuid, { title, color });
    set((s) => ({ phasesByProject: { ...s.phasesByProject, [projectUuid]: [...(s.phasesByProject[projectUuid] ?? []), phase] } }));
    void get().refreshActivity();
    return phase;
  },

  async updatePhase(phaseUuid, input) {
    const phase = await api.updatePhase(phaseUuid, input);
    set((s) => ({
      phasesByProject: {
        ...s.phasesByProject,
        [phase.projectUuid]: (s.phasesByProject[phase.projectUuid] ?? []).map((x) => (x.uuid === phaseUuid ? phase : x)),
      },
    }));
    void get().refreshActivity();
  },

  async deletePhase(phaseUuid) {
    await api.deletePhase(phaseUuid);
    set((s) => {
      const projectUuid = Object.keys(s.phasesByProject).find((uuid) => s.phasesByProject[uuid].some((x) => x.uuid === phaseUuid));
      if (!projectUuid) return {};
      return {
        phasesByProject: { ...s.phasesByProject, [projectUuid]: s.phasesByProject[projectUuid].filter((x) => x.uuid !== phaseUuid) },
        sectionsByProject: {
          ...s.sectionsByProject,
          [projectUuid]: (s.sectionsByProject[projectUuid] ?? []).map((section) => (section.phaseUuid === phaseUuid ? { ...section, phaseUuid: null } : section)),
        },
      };
    });
    void get().refreshActivity();
  },

  async reorderPhases(projectUuid, orderedPhaseUuids) {
    const previous = get().phasesByProject[projectUuid];
    const order = new Map(orderedPhaseUuids.map((uuid, i) => [uuid, i]));
    set((s) => {
      const next = (s.phasesByProject[projectUuid] ?? []).map((x) => (order.has(x.uuid) ? { ...x, position: order.get(x.uuid)! } : x)).sort((a, b) => a.position - b.position);
      return { phasesByProject: { ...s.phasesByProject, [projectUuid]: next } };
    });
    try {
      const phases = await api.reorderPhases(projectUuid, { orderedPhaseUuids });
      set((s) => ({ phasesByProject: { ...s.phasesByProject, [projectUuid]: phases } }));
    } catch {
      if (previous) set((s) => ({ phasesByProject: { ...s.phasesByProject, [projectUuid]: previous } }));
    }
  },

  async addComment(taskUuid, body) {
    const comment = await api.addComment(taskUuid, body);
    set((s) => {
      const projectUuid = findProjectUuidOfTask(s, taskUuid);
      const current = projectUuid ? s.tasksByProject[projectUuid].find((t) => t.uuid === taskUuid) : undefined;
      return {
        commentsByTask: { ...s.commentsByTask, [taskUuid]: [...(s.commentsByTask[taskUuid] ?? []), comment] },
        ...patchTask(s, taskUuid, { commentCount: (current?.commentCount ?? 0) + 1 }),
      };
    });
  },

  async addSectionReference(sectionUuid, input) {
    const reference = await api.addSectionReference(sectionUuid, input);
    set((s) => patchSection(s, sectionUuid, (section) => ({ ...section, references: [...(section.references ?? []), reference] })));
    void get().refreshActivity();
  },

  async deleteSectionReference(sectionUuid, referenceUuid) {
    await api.deleteSectionReference(sectionUuid, referenceUuid);
    set((s) => patchSection(s, sectionUuid, (section) => ({ ...section, references: (section.references ?? []).filter((r) => r.uuid !== referenceUuid) })));
    void get().refreshActivity();
  },

  // ---- membership & invitations -----------------------------------------

  async loadProjectInvitations(projectUuid) {
    const invitations = await api.listProjectInvitations(projectUuid);
    set((s) => ({ invitationsByProject: { ...s.invitationsByProject, [projectUuid]: invitations } }));
  },

  async inviteMember(projectUuid, input) {
    const invitation = await api.inviteMember(projectUuid, input);
    set((s) => ({ invitationsByProject: { ...s.invitationsByProject, [projectUuid]: [invitation, ...(s.invitationsByProject[projectUuid] ?? [])] } }));
    void get().refreshActivity();
    return invitation;
  },

  async revokeInvitation(projectUuid, invitationUuid) {
    const invitation = await api.revokeInvitation(projectUuid, invitationUuid);
    set((s) => ({
      invitationsByProject: { ...s.invitationsByProject, [projectUuid]: (s.invitationsByProject[projectUuid] ?? []).map((i) => (i.uuid === invitationUuid ? invitation : i)) },
    }));
    void get().refreshActivity();
  },

  async updateMemberRole(projectUuid, memberUuid, role) {
    const project = await api.updateMemberRole(projectUuid, memberUuid, role);
    set((s) => replaceProject(s, project));
    void get().refreshActivity();
  },

  async removeMember(projectUuid, memberUuid) {
    const project = await api.removeMember(projectUuid, memberUuid);
    set((s) => replaceProject(s, project));
    void get().refreshActivity();
  },

  async transferOwnership(projectUuid, memberUuid) {
    const project = await api.transferOwnership(projectUuid, memberUuid);
    set((s) => replaceProject(s, project));
    void get().refreshActivity();
  },

  async leaveProject(projectUuid) {
    await api.leaveProject(projectUuid);
    set((s) => forgetProject(s, projectUuid));
  },

  async loadMyInvitations(force = false) {
    const state = get().myInvitationsState;
    if (!force && state !== "idle" && state !== "error") return;
    if (state !== "ready") set({ myInvitationsState: "loading" });
    try {
      const myInvitations = await api.listMyInvitations();
      set({ myInvitations, myInvitationsState: "ready" });
    } catch {
      set((s) => ({ myInvitationsState: s.myInvitationsState === "ready" ? "ready" : "error" }));
    }
  },

  async acceptInvitation(invitationUuid) {
    const project = await api.acceptInvitation(invitationUuid);
    set((s) => ({
      myInvitations: s.myInvitations.filter((i) => i.uuid !== invitationUuid),
      projects: s.projects.some((p) => p.uuid === project.uuid) ? s.projects.map((p) => (p.uuid === project.uuid ? project : p)) : [project, ...s.projects],
    }));
    void get().refreshActivity();
    return project;
  },

  async acceptInvitationByToken(token) {
    const project = await api.acceptInvitationByToken(token);
    set((s) => ({
      myInvitations: s.myInvitations.filter((i) => i.projectUuid !== project.uuid),
      projects: s.projects.some((p) => p.uuid === project.uuid) ? s.projects.map((p) => (p.uuid === project.uuid ? project : p)) : [project, ...s.projects],
    }));
    void get().refreshActivity();
    return project;
  },

  async declineInvitation(invitationUuid) {
    await api.declineInvitation(invitationUuid);
    set((s) => ({ myInvitations: s.myInvitations.filter((i) => i.uuid !== invitationUuid) }));
  },

  async loadExportTemplates() {
    const state = get().exportTemplatesState;
    if (state === "loading" || state === "ready") return;
    set({ exportTemplatesState: "loading" });
    try {
      set({ exportTemplates: await api.listExportTemplates(), exportTemplatesState: "ready" });
    } catch {
      set({ exportTemplatesState: "error" });
    }
  },

  async exportProject(projectUuid, input) {
    const file = await api.exportProject(projectUuid, input);
    void get().refreshActivity();
    return file;
  },
}));

// A 401 on any authenticated call means the session expired or was revoked
// elsewhere; drop local state so the route guard sends the user to sign in.
onUnauthorized(() => {
  if (useAppStore.getState().bootState === "ready") useAppStore.getState().resetSession();
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const selectProject = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.projects.find((p) => p.uuid === uuid) ?? null : null);
export const selectSections = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.sectionsByProject[uuid] : undefined);
export const selectTasks = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.tasksByProject[uuid] : undefined);
export const selectProjectLoadState = (uuid: Uuid | null) => (s: AppState): LoadState => (uuid ? s.projectLoadState[uuid] ?? "idle" : "idle");

const EMPTY_TASKS: Task[] = [];
const EMPTY_SECTIONS: ChecklistSection[] = [];
const EMPTY_PHASES: Phase[] = [];
export const selectTasksOrEmpty = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.tasksByProject[uuid] ?? EMPTY_TASKS : EMPTY_TASKS);
export const selectSectionsOrEmpty = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.sectionsByProject[uuid] ?? EMPTY_SECTIONS : EMPTY_SECTIONS);
export const selectPhasesOrEmpty = (uuid: Uuid | null) => (s: AppState) => (uuid ? s.phasesByProject[uuid] ?? EMPTY_PHASES : EMPTY_PHASES);
