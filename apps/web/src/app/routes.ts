import type { Uuid } from "@scope/contracts";

/** Central route builders so paths are never hand-written in components. */
export const routes = {
  dashboard: () => "/",
  projects: () => "/projects",
  project: (projectUuid: Uuid) => `/projects/${projectUuid}`,
  section: (projectUuid: Uuid, sectionUuid: Uuid) => `/projects/${projectUuid}/sections/${sectionUuid}`,
  activity: () => "/activity",
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

  // Public (unauthenticated) pages
  login: (next?: string) => (next && next !== "/" ? `/login?${NEXT_PARAM}=${encodeURIComponent(next)}` : "/login"),
  register: () => "/register",
  forgotPassword: () => "/forgot-password",
  resetPassword: () => "/reset-password",
} as const;

/** Query parameter carrying the page to return to after signing in. */
export const NEXT_PARAM = "next";

/** Only accept same-origin paths as a post-login destination (no open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

/** Query parameter that opens the task detail sheet on any page. */
export const TASK_PARAM = "task";
export const SEARCH_PARAM = "q";

/** Depth used to decide the slide direction between pages. */
export function routeDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}
