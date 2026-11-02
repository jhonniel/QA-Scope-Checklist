import type { Project, ProjectMemberRole, User } from "@scope/contracts";

/**
 * Client-side mirror of the backend's project access rules, used only to hide
 * or disable controls. The API is the source of truth and enforces the same
 * rules on every request.
 */

export function memberRole(project: Project | null | undefined, user: User | null | undefined): ProjectMemberRole | null {
  if (!project || !user) return null;
  if (project.owner.uuid === user.uuid) return "owner";
  return project.members.find((m) => m.user.uuid === user.uuid)?.role ?? null;
}

/** Owners, editors and admins may change tasks and sections; viewers may only read and comment. */
export function canEditProject(project: Project | null | undefined, user: User | null | undefined): boolean {
  if (!project || !user) return false;
  if (user.role === "admin") return true;
  const role = memberRole(project, user);
  return role === "owner" || role === "editor";
}

/** Only owners and admins manage membership. */
export function canManageMembers(project: Project | null | undefined, user: User | null | undefined): boolean {
  if (!project || !user) return false;
  return user.role === "admin" || memberRole(project, user) === "owner";
}

/** Any member except the owner may leave (owners transfer ownership first). */
export function canLeaveProject(project: Project | null | undefined, user: User | null | undefined): boolean {
  const role = memberRole(project, user);
  return role === "editor" || role === "viewer";
}
