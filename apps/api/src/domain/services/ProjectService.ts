import type { CreateProjectInput, Project, ProjectMemberRole, UpdateProjectInput } from "@scope/contracts";
import type { Database, Queryable } from "../../db/database.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors.ts";
import { toMember, toProject, toStats, type Actor, type ProjectRow } from "../models.ts";
import { repositories } from "../repositories/index.ts";

/** Effective access of an actor on a project. Admins bypass membership. */
export type ProjectAccess = ProjectMemberRole | "admin";

const todayIso = () => new Date().toISOString().slice(0, 10);

export class ProjectService {
  constructor(private readonly db: Database) {}

  // ---- authorization helpers (used by every project-scoped service) -----

  async accessFor(actor: Actor, project: ProjectRow, q: Queryable = this.db): Promise<ProjectAccess | null> {
    if (actor.role === "admin") return "admin";
    return repositories(q).projects.memberRole(project.id, actor.id);
  }

  /** Load a project the actor may at least view, or 404 (never reveal existence). */
  async requireViewable(actor: Actor, projectUuid: string, q: Queryable = this.db): Promise<{ project: ProjectRow; access: ProjectAccess }> {
    const project = await repositories(q).projects.findByUuid(projectUuid);
    if (!project) throw new NotFoundError("Project");
    const access = await this.accessFor(actor, project, q);
    if (!access) throw new NotFoundError("Project");
    return { project, access };
  }

  /** Same as `requireViewable` but viewers are rejected. */
  async requireEditable(actor: Actor, projectUuid: string, q: Queryable = this.db): Promise<{ project: ProjectRow; access: ProjectAccess }> {
    const result = await this.requireViewable(actor, projectUuid, q);
    assertCanEdit(result.access);
    return result;
  }

  // ---- queries ------------------------------------------------------------

  async list(actor: Actor): Promise<Project[]> {
    const repos = repositories(this.db);
    const rows = await repos.projects.listVisible(actor.id, actor.role === "admin");
    return this.hydrate(rows);
  }

  async get(actor: Actor, projectUuid: string): Promise<Project> {
    const { project } = await this.requireViewable(actor, projectUuid);
    return (await this.hydrate([project]))[0];
  }

  /** Attach members and SQL-computed statistics. */
  async hydrate(rows: ProjectRow[], q: Queryable = this.db): Promise<Project[]> {
    if (rows.length === 0) return [];
    const repos = repositories(q);
    const ids = rows.map((r) => r.id);
    const [members, stats] = await Promise.all([repos.projects.membersFor(ids), repos.projects.statsFor(ids, todayIso())]);
    const membersByProject = new Map<number, ReturnType<typeof toMember>[]>();
    for (const m of members) {
      const list = membersByProject.get(Number(m.project_id)) ?? [];
      list.push(toMember(m));
      membersByProject.set(Number(m.project_id), list);
    }
    return rows.map((row) => toProject(row, membersByProject.get(row.id) ?? [], toStats(stats.get(row.id))));
  }

  // ---- commands -----------------------------------------------------------

  async create(actor: Actor, input: CreateProjectInput): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const project = await repos.projects.create({
        ownerId: actor.id,
        name: input.name,
        description: input.description ?? "",
        startDate: input.startDate ?? null,
        deadline: input.deadline ?? null,
      });
      await repos.projects.addMember(project.id, actor.id, "owner");
      // Every project starts with one section so tasks can be added immediately.
      await repos.sections.create({ projectId: project.id, title: "General", description: null, position: 0 });
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.created", subject: project.name });
      return (await this.hydrate([project], tx))[0];
    });
  }

  /**
   * Edit details and/or lifecycle status. Editors may change name, description
   * and dates; only the owner (or an admin) may change the status.
   */
  async update(actor: Actor, projectUuid: string, input: UpdateProjectInput): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);

      if (input.startDate !== undefined || input.deadline !== undefined) {
        const start = input.startDate === undefined ? project.start_date : input.startDate;
        const end = input.deadline === undefined ? project.deadline : input.deadline;
        if (start && end && end < start) throw new ValidationError([{ field: "deadline", message: "The deadline must be after the start date." }]);
      }

      const statusChanged = input.status !== undefined && input.status !== project.status;
      if (statusChanged) assertCanManage(access);

      const detailsChanged =
        (input.name !== undefined && input.name.trim() !== project.name) ||
        (input.description !== undefined && input.description.trim() !== (project.description ?? "")) ||
        (input.startDate !== undefined && input.startDate !== project.start_date) ||
        (input.deadline !== undefined && input.deadline !== project.deadline);

      const updated = await repos.projects.update(project.id, {
        name: input.name,
        description: input.description,
        startDate: input.startDate,
        deadline: input.deadline,
        status: statusChanged ? input.status : undefined,
      });

      if (detailsChanged) await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.updated", subject: updated.name });
      if (statusChanged) {
        await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.status_changed", subject: updated.name, meta: { from: project.status, to: input.status } });
      }
      return (await this.hydrate([updated], tx))[0];
    });
  }

  /** Owner/admin only. Soft delete — members, tasks and the activity log are retained for auditing. */
  async delete(actor: Actor, projectUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { project, access } = await this.requireViewable(actor, projectUuid, tx);
      assertCanManage(access);
      const repos = repositories(tx);
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "project.deleted", subject: project.name });
      await repos.projects.softDelete(project.id);
    });
  }
}

export function canEdit(access: ProjectAccess): boolean {
  return access === "admin" || access === "owner" || access === "editor";
}

export function assertCanEdit(access: ProjectAccess): void {
  if (!canEdit(access)) throw new ForbiddenError("Viewers cannot change this project.");
}

export function canManage(access: ProjectAccess): boolean {
  return access === "admin" || access === "owner";
}

export function assertCanManage(access: ProjectAccess): void {
  if (!canManage(access)) throw new ForbiddenError("Only the project owner can do that.");
}
