import type { Uuid } from "@scope/contracts";

/** Central route builders so paths are never hand-written in components. */
export const routes = {
  /** Sign-in. Signed-in visitors are sent to the dashboard. */
  home: () => "/",
  dashboard: () => "/dashboard",
  projects: () => "/projects",
  project: (projectUuid: Uuid) => `/projects/${projectUuid}`,
  section: (projectUuid: Uuid, sectionUuid: Uuid) => `/projects/${projectUuid}/sections/${sectionUuid}`,
  activity: (projectUuid?: Uuid) => (projectUuid ? `/activity?project=${projectUuid}` : "/activity"),
  profile: () => "/profile",
  invitations: () => "/invitations",
  /** Target of the e-mailed invitation link; accepts on open. */
  invitationToken: (token: string) => `/invitations/${encodeURIComponent(token)}`,

  // Administration (admin role only)
  admin: () => "/admin",
  adminUsers: () => "/admin/users",
  adminProjects: () => "/admin/projects",
  adminAudit: () => "/admin/audit",
  adminProductivity: () => "/admin/productivity",
  adminErrors: () => "/admin/errors",

  /** Public share page (no sign-in). */
  share: (token: string) => `/s/${encodeURIComponent(token)}`,

  // Public (unauthenticated) pages
  login: (next?: string) =>
    next && next !== "/" && next !== "/dashboard" ? `/login?${NEXT_PARAM}=${encodeURIComponent(next)}` : "/login",
  register: () => "/register",
  forgotPassword: () => "/forgot-password",
  resetPassword: () => "/reset-password",
} as const;

/** Query parameter carrying the page to return to after signing in. */
export const NEXT_PARAM = "next";

/** Sign-in and account pages — never send a signed-in user back here. */
const AUTH_PATHS = new Set(["/", "/login", "/register", "/forgot-password", "/reset-password"]);

/** Only accept same-origin app paths as a post-login destination (no open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  const path = value.split("?")[0] ?? value;
  if (AUTH_PATHS.has(path) || path.startsWith("/login/") || path.startsWith("/register/")) return fallback;
  return value;
}

/** Query parameter that opens the task detail sheet on any page. */
export const TASK_PARAM = "task";
export const SEARCH_PARAM = "q";

/** Depth used to decide the slide direction between pages. */
export function routeDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}
