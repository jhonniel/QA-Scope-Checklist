import type { ActivityLog, ApiFailure, ApiResponse, ApiSuccess, Paginated, Uuid } from "@scope/contracts";
import type { ExportedFile, ScopeApi } from "./types";
import { ApiError } from "./ApiError";

/**
 * HTTP implementation of the API contract against the REST backend.
 *
 * - Authentication is an httpOnly session cookie, so every call sends
 *   `credentials: "include"`; nothing is kept in local storage.
 * - `X-Requested-With` marks requests as same-app for the backend's CSRF check.
 * - Every response is the `{ success, data | error }` envelope from contracts;
 *   failures become `ApiError` so the UI can branch on `code`/`fields`.
 */

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

type TokenProvider = () => Promise<string | null>;
let tokenProvider: TokenProvider | null = null;

/**
 * Install a bearer-token source (Clerk). When set, every request carries
 * `Authorization: Bearer <token>` in addition to the cookie; the API decides
 * which one it honours based on its configured provider. The token is asked
 * for per request and never stored by this module.
 */
export function setAuthTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

/** Subscribe to 401s from any call except `getCurrentUser` (used to bounce to the login page). */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Reads the file name from an RFC 6266 header, preferring the UTF-8 `filename*`. */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      /* fall through to the plain name */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : null;
}

export function createHttpApi(baseUrl: string): ScopeApi {
  const base = baseUrl.replace(/\/+$/, "");

  /** Like `request` but keeps the whole success envelope (needed for `meta` on paged lists). */
  async function requestEnvelope<T>(method: string, path: string, body?: unknown, opts: { silent401?: boolean } = {}): Promise<ApiSuccess<T>> {
    let response: Response;
    try {
      const token = tokenProvider ? await tokenProvider().catch(() => null) : null;
      response = await fetch(base + path, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network_error", "Cannot reach the server. Check your connection and try again.");
    }

    let payload: ApiResponse<T> | null = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text) as ApiResponse<T>;
      } catch {
        payload = null;
      }
    }

    if (payload && payload.success) return payload;

    const code = payload && !payload.success ? payload.error.code : response.ok ? "invalid_response" : "http_error";
    const message = payload && !payload.success ? payload.error.message : `Unexpected server response (${response.status}).`;
    const fields = payload && !payload.success ? payload.error.fields ?? [] : [];
    if (response.status === 401 && !opts.silent401) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(response.status, code, message, fields);
  }

  const request = <T>(method: string, path: string, body?: unknown, opts?: { silent401?: boolean }) => requestEnvelope<T>(method, path, body, opts).then((p) => p.data);

  /** For the one endpoint whose success body is a file. Failures still arrive as the JSON envelope. */
  async function requestFile(method: string, path: string, body: unknown): Promise<ExportedFile> {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        credentials: "include",
        headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/json", "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network_error", "Cannot reach the server. Check your connection and try again.");
    }

    if (!response.ok) {
      let payload: ApiFailure | null = null;
      try {
        payload = (await response.json()) as ApiFailure;
      } catch {
        payload = null;
      }
      if (response.status === 401) unauthorizedListeners.forEach((l) => l());
      const error = payload && payload.success === false ? payload.error : null;
      throw new ApiError(response.status, error?.code ?? "http_error", error?.message ?? `Unexpected server response (${response.status}).`, error?.fields ?? []);
    }

    return {
      blob: await response.blob(),
      fileName: fileNameFromDisposition(response.headers.get("Content-Disposition")) ?? "scope-checklist.docx",
      template: decodeURIComponent(response.headers.get("X-Export-Template") ?? "Default"),
      sectionCount: Number(response.headers.get("X-Export-Sections") ?? 0),
      taskCount: Number(response.headers.get("X-Export-Tasks") ?? 0),
    };
  }

  const get = <T>(path: string, opts?: { silent401?: boolean }) => request<T>("GET", path, undefined, opts);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
  const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
  const del = <T>(path: string) => request<T>("DELETE", path);
  const q = (params: Record<string, string | number | undefined>) => {
    const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "");
    return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : "";
  };

  /** Paged GET: `data` is the page of items, paging lives in `meta`. */
  async function getPage<T>(path: string, params: Record<string, string | number | undefined>, defaults: { page?: number; perPage?: number }): Promise<Paginated<T>> {
    const page = defaults.page ?? 1;
    const perPage = defaults.perPage ?? 25;
    const envelope = await requestEnvelope<T[]>("GET", `${path}${q({ ...params, page, perPage })}`);
    const meta = envelope.meta ?? {};
    return { items: envelope.data, page: meta.page ?? page, perPage: meta.perPage ?? perPage, total: meta.total ?? envelope.data.length, totalPages: meta.totalPages ?? 1 };
  }

  return {
    async getCurrentUser() {
      try {
        return await get("/auth/me", { silent401: true });
      } catch (error) {
        if (ApiError.is(error) && error.status === 401) return null;
        throw error;
      }
    },
    register: (input) => post("/auth/register", input),
    login: (input) => post("/auth/login", input),
    logout: () => post<null>("/auth/logout").then(() => undefined),
    updateProfile: (input) => patch("/auth/profile", input),
    changePassword: (input) => post<null>("/auth/password", input).then(() => undefined),
    requestPasswordReset: (email) => post<null>("/auth/forgot-password", { email }).then(() => undefined),
    resetPassword: (input) => post<null>("/auth/reset-password", input).then(() => undefined),

    listProjects: () => get("/projects"),
    getProject: (uuid) => get(`/projects/${uuid}`),
    listSections: (projectUuid) => get(`/projects/${projectUuid}/sections`),
    listTasks: (projectUuid) => get(`/projects/${projectUuid}/tasks`),
    listComments: (taskUuid) => get(`/tasks/${taskUuid}/comments`),
    listActivity: (projectUuid?: Uuid) => get(`/activity${q({ project: projectUuid })}`),
    async listActivityPage(query) {
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 25;
      const envelope = await requestEnvelope<ActivityLog[]>("GET", `/activity${q({ project: query.project, type: query.type ?? "all", page, perPage })}`);
      const meta = envelope.meta ?? {};
      return {
        items: envelope.data,
        page: meta.page ?? page,
        perPage: meta.perPage ?? perPage,
        total: meta.total ?? envelope.data.length,
        totalPages: meta.totalPages ?? 1,
      };
    },

    listProjectInvitations: (projectUuid) => get(`/projects/${projectUuid}/invitations`),
    inviteMember: (projectUuid, input) => post(`/projects/${projectUuid}/invitations`, input),
    revokeInvitation: (projectUuid, invitationUuid) => del(`/projects/${projectUuid}/invitations/${invitationUuid}`),
    updateMemberRole: (projectUuid, memberUuid, role) => patch(`/projects/${projectUuid}/members/${memberUuid}`, { role }),
    removeMember: (projectUuid, memberUuid) => del(`/projects/${projectUuid}/members/${memberUuid}`),
    transferOwnership: (projectUuid, memberUuid) => post(`/projects/${projectUuid}/members/transfer`, { memberUuid }),
    leaveProject: (projectUuid) => post<null>(`/projects/${projectUuid}/members/leave`).then(() => undefined),
    listMyInvitations: () => get("/invitations"),
    acceptInvitation: (invitationUuid) => post(`/invitations/${invitationUuid}/accept`),
    acceptInvitationByToken: (token) => post("/invitations/accept-token", { token }),
    declineInvitation: (invitationUuid) => post<null>(`/invitations/${invitationUuid}/decline`).then(() => undefined),

    listExportTemplates: () => get("/export-templates"),
    exportProject: (projectUuid, input) => requestFile("POST", `/projects/${projectUuid}/exports`, input),

    adminStats: () => get("/admin/stats"),
    adminProductivity: (query) => get(`/admin/productivity${q({ period: query.period })}`),
    adminListUsers: (query) => getPage("/admin/users", { search: query.search, role: query.role, status: query.status }, query),
    adminUpdateUser: (userUuid, input) => patch(`/admin/users/${userUuid}`, input),
    adminSetUserDisabled: (userUuid, disabled) => post(`/admin/users/${userUuid}/${disabled ? "disable" : "enable"}`),
    adminRevokeUserSessions: (userUuid) => post<null>(`/admin/users/${userUuid}/revoke-sessions`).then(() => undefined),
    adminSendPasswordReset: (userUuid) => post<null>(`/admin/users/${userUuid}/password-reset`).then(() => undefined),
    adminListProjects: (query) => getPage("/admin/projects", { search: query.search, status: query.status }, query),
    adminRestoreProject: (projectUuid) => post(`/admin/projects/${projectUuid}/restore`),
    adminListAudit: (query) => getPage("/admin/audit", {}, query),
    adminListErrors: (query) => getPage("/admin/errors", { source: query.source, search: query.search }, query),
    adminGetError: (errorUuid) => get(`/admin/errors/${errorUuid}`),
    reportError: (report) => post("/errors", report),

    createProject: (input) => post("/projects", input),
    updateProject: (projectUuid, input) => patch(`/projects/${projectUuid}`, input),
    deleteProject: (projectUuid) => del<null>(`/projects/${projectUuid}`).then(() => undefined),
    createSection: (projectUuid, input) => post(`/projects/${projectUuid}/sections`, input),
    updateSection: (sectionUuid, input) => patch(`/sections/${sectionUuid}`, input),
    deleteSection: (sectionUuid) => del<null>(`/sections/${sectionUuid}`).then(() => undefined),
    reorderSections: (projectUuid, input) => post(`/projects/${projectUuid}/sections/reorder`, input),
    createTask: (projectUuid, input) => post(`/projects/${projectUuid}/tasks`, input),
    updateTask: (taskUuid, input) => patch(`/tasks/${taskUuid}`, input),
    deleteTask: (taskUuid) => del<null>(`/tasks/${taskUuid}`).then(() => undefined),
    reorderTasks: (projectUuid, input) => post(`/projects/${projectUuid}/tasks/reorder`, input),
    addComment: (taskUuid, body) => post(`/tasks/${taskUuid}/comments`, { body }),
  };
}
