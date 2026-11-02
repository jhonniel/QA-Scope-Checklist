import type { ActivityAction, ActivityLog, ActivityType, Paginated } from "@scope/contracts";
import type { Database } from "../../db/database.ts";
import { toActivity, type Actor } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { ProjectService } from "./ProjectService.ts";

/** Which actions each coarse history filter covers. `all` = no filter. */
export const ACTIVITY_TYPE_ACTIONS: Record<Exclude<ActivityType, "all">, readonly ActivityAction[]> = {
  tasks: ["task.created", "task.updated", "task.status_changed", "task.deleted", "task.assigned"],
  checks: ["task.checked", "task.unchecked"],
  comments: ["comment.added"],
  members: ["member.invited", "member.joined", "member.removed", "member.left", "member.role_changed", "member.invitation_declined", "member.invitation_revoked", "project.ownership_transferred"],
  project: ["project.created", "project.updated", "project.status_changed", "project.deleted", "project.restored", "section.created", "section.updated", "section.deleted", "export.generated"],
};

export class ActivityService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
  ) {}

  /** Feed for one project (must be viewable) or for every project the actor can see. */
  async list(actor: Actor, projectUuid: string | undefined, limit = 100): Promise<ActivityLog[]> {
    const repos = repositories(this.db);
    if (projectUuid) {
      const { project } = await this.projects.requireViewable(actor, projectUuid);
      return (await repos.activity.list([project.id], limit)).map(toActivity);
    }
    if (actor.role === "admin") return (await repos.activity.list(null, limit)).map(toActivity);
    const visible = await repos.projects.listVisible(actor.id, false);
    return (await repos.activity.list(visible.map((p) => p.id), limit)).map(toActivity);
  }

  /** Paginated, filterable history with the same visibility rules as `list`. */
  async page(actor: Actor, query: { project?: string; type?: ActivityType; page?: number; perPage?: number }): Promise<Paginated<ActivityLog>> {
    const repos = repositories(this.db);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const actions = query.type && query.type !== "all" ? ACTIVITY_TYPE_ACTIONS[query.type] : undefined;

    let scope: number[] | null;
    if (query.project) {
      const { project } = await this.projects.requireViewable(actor, query.project);
      scope = [project.id];
    } else if (actor.role === "admin") {
      scope = null;
    } else {
      scope = (await repos.projects.listVisible(actor.id, false)).map((p) => p.id);
    }

    const { rows, total } = await repos.activity.page(scope, { page, perPage, actions });
    return { items: rows.map(toActivity), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }
}
