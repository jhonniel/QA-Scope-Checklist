import type { ActivityAction, ActivityLog, ActivityType, Paginated } from "@scope/contracts";
import type { Database } from "../../db/database.ts";
import { ForbiddenError } from "../errors.ts";
import { toActivity, type Actor } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { ProjectService } from "./ProjectService.ts";

/** Which actions each coarse history filter covers. `all` = no filter. */
export const ACTIVITY_TYPE_ACTIONS: Record<Exclude<ActivityType, "all">, readonly ActivityAction[]> = {
  tasks: ["task.created", "task.updated", "task.status_changed", "task.deleted", "task.assigned"],
  checks: ["task.checked", "task.unchecked"],
  comments: ["comment.added", "section.note_added", "section.link_added", "section.reference_deleted"],
  members: ["member.invited", "member.joined", "member.removed", "member.left", "member.role_changed", "member.invitation_declined", "member.invitation_revoked", "project.ownership_transferred"],
  project: ["project.created", "project.updated", "project.status_changed", "project.deleted", "project.restored", "section.created", "section.updated", "section.deleted", "section.completed", "phase.created", "phase.updated", "phase.deleted", "export.generated"],
};

export class ActivityService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
  ) {}

  /** Feed for one project the actor owns, or for every project they own. */
  async list(actor: Actor, projectUuid: string | undefined, limit = 100): Promise<ActivityLog[]> {
    const repos = repositories(this.db);
    if (projectUuid) {
      const { project } = await this.requireOwner(actor, projectUuid);
      return (await repos.activity.list([project.id], limit)).map(toActivity);
    }
    const owned = await repos.projects.listOwned(actor.id);
    return (await repos.activity.list(owned.map((p) => p.id), limit)).map(toActivity);
  }

  /** Paginated, filterable history with the same visibility rules as `list`. */
  async page(actor: Actor, query: { project?: string; type?: ActivityType; page?: number; perPage?: number }): Promise<Paginated<ActivityLog>> {
    const repos = repositories(this.db);
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.max(1, Math.min(100, query.perPage ?? 25));
    const actions = query.type && query.type !== "all" ? ACTIVITY_TYPE_ACTIONS[query.type] : undefined;

    let scope: number[];
    if (query.project) {
      const { project } = await this.requireOwner(actor, query.project);
      scope = [project.id];
    } else {
      scope = (await repos.projects.listOwned(actor.id)).map((p) => p.id);
    }

    const { rows, total } = await repos.activity.page(scope, { page, perPage, actions });
    return { items: rows.map(toActivity), page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) };
  }

  /**
   * Members can work on a project; only the recorded owner may read its log.
   * Non-members still get a 404 so we do not confirm the project exists.
   */
  private async requireOwner(actor: Actor, projectUuid: string) {
    const { project } = await this.projects.requireViewable(actor, projectUuid);
    if (project.owner_id !== actor.id) throw new ForbiddenError("Only the project owner can view the activity log.");
    return { project };
  }
}
