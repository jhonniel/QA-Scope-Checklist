import { randomUUID } from "node:crypto";
import {
  RESOLVED_TASK_STATUSES,
  type ChecklistSection,
  type Phase,
  type ProjectShareSettings,
  type PublicClientCheckInput,
  type PublicShareSnapshot,
  type SectionReference,
  type Task,
  type TaskComment,
  type UpdateProjectShareInput,
  type UserSummary,
} from "@scope/contracts";
import { nowSql, toBool, type Database, type Queryable } from "../../db/database.ts";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors.ts";
import { toComment, toPhase, toSection, toSectionReference, toStats, toTask, type Actor, type ProjectRow, type SectionRow } from "../models.ts";
import { repositories, type Repositories } from "../repositories/index.ts";
import { assertCanEdit, type ProjectService } from "./ProjectService.ts";

function redactUser(user: UserSummary): UserSummary {
  return { ...user, email: "" };
}

function redactTask(task: Task): Task {
  return {
    ...task,
    developerCheck: task.developerCheck ? { ...task.developerCheck, checkedBy: redactUser(task.developerCheck.checkedBy) } : null,
    clientCheck: task.clientCheck ? { ...task.clientCheck, checkedBy: redactUser(task.clientCheck.checkedBy) } : null,
    assignee: task.assignee ? redactUser(task.assignee) : null,
  };
}

function redactReference(ref: SectionReference): SectionReference {
  return { ...ref, author: redactUser(ref.author) };
}

function redactComment(comment: TaskComment): TaskComment {
  return { ...comment, author: redactUser(comment.author) };
}

function redactSection(section: ChecklistSection): ChecklistSection {
  return { ...section, references: section.references.map(redactReference) };
}

/** Public share links and guest Client ticks. */
export class ShareService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
  ) {}

  async settings(actor: Actor, projectUuid: string): Promise<ProjectShareSettings> {
    const { project } = await this.projects.requireEditable(actor, projectUuid);
    const sections = await repositories(this.db).sections.listByProject(project.id);
    return this.toSettings(project, sections);
  }

  async update(actor: Actor, projectUuid: string, input: UpdateProjectShareInput): Promise<ProjectShareSettings> {
    return this.db.transaction(async (tx) => {
      const { project, access } = await this.projects.requireViewable(actor, projectUuid, tx);
      assertCanEdit(access);
      const repos = repositories(tx);

      let token = project.share_token ?? null;
      let enabled = toBool(project.share_enabled);
      if (input.enabled !== undefined) enabled = input.enabled;
      if (enabled && !token) token = randomUUID();
      if (input.rotateToken) token = randomUUID();

      const updated = await repos.projects.update(project.id, {
        shareEnabled: enabled,
        shareToken: token,
      });

      if (input.publicSectionUuids !== undefined) {
        const ids = await repos.sections.idsForUuids(project.id, input.publicSectionUuids);
        if (ids.length !== input.publicSectionUuids.length) {
          throw new ValidationError([{ field: "publicSectionUuids", message: "Every selected scope must belong to this project." }]);
        }
        await repos.sections.setPublicVisible(project.id, ids);
      }

      if (input.enabled !== undefined && input.enabled !== toBool(project.share_enabled)) {
        await repos.activity.record({
          projectId: project.id,
          actorId: actor.id,
          action: "project.share_updated",
          subject: updated.name,
          meta: { enabled },
        });
      } else if (input.rotateToken || input.publicSectionUuids !== undefined) {
        await repos.activity.record({
          projectId: project.id,
          actorId: actor.id,
          action: "project.share_updated",
          subject: updated.name,
          meta: { enabled, rotated: Boolean(input.rotateToken) },
        });
      }

      const sections = await repos.sections.listByProject(project.id);
      return this.toSettings(updated, sections);
    });
  }

  async snapshot(token: string): Promise<PublicShareSnapshot> {
    const { project, repos } = await this.requireLiveShare(token);
    const sectionRows = await repos.sections.listPublicByProject(project.id);
    const sections = await this.presentSections(repos, sectionRows);
    const publicIds = new Set(sectionRows.map((row) => row.id));
    const allTasks = await repos.tasks.listByProject(project.id);
    const tasks = allTasks.filter((row) => publicIds.has(row.section_id)).map((row) => redactTask(toTask(row)));
    const phases = await this.publicPhases(repos, project.id, sectionRows);
    return {
      token,
      project: {
        name: project.name,
        description: project.description ?? "",
        status: project.status as PublicShareSnapshot["project"]["status"],
        stats: toStats(this.statsFromTasks(tasks, sections.length)),
      },
      phases,
      sections: sections.map(redactSection),
      tasks,
    };
  }

  async listComments(token: string, taskUuid: string): Promise<TaskComment[]> {
    const { task, repos } = await this.requirePublicTask(token, taskUuid);
    return (await repos.comments.listByTask(task.id)).map((row) => redactComment(toComment(row)));
  }

  async setClientCheck(token: string, taskUuid: string, input: PublicClientCheckInput): Promise<Task> {
    return this.db.transaction(async (tx) => {
      const { task, repos } = await this.requirePublicTask(token, taskUuid, tx);
      const state = (await repos.tasks.checkState(task.id))!;
      const currentlyChecked = state.client_checked_at !== null;
      if (input.clientChecked === currentlyChecked) return redactTask(toTask(task));

      if (!input.clientChecked && state.client_checked_by !== null) {
        throw new ForbiddenError("Only the project team can clear a Client check made by a member.");
      }

      const guestName = (input.guestName ?? "").trim();
      if (input.clientChecked) {
        if (guestName.length < 2) throw new ValidationError([{ field: "guestName", message: "Enter your name." }]);
        if (guestName.length > 80) throw new ValidationError([{ field: "guestName", message: "Use at most 80 characters." }]);
      }

      const updated = await repos.tasks.update(task.id, {
        clientCheck: input.clientChecked ? { userId: null, guestName, at: nowSql() } : null,
      });
      await repos.projects.touch(task.project_id);
      return redactTask(toTask(updated));
    });
  }

  private toSettings(project: ProjectRow, sections: SectionRow[]): ProjectShareSettings {
    return {
      enabled: toBool(project.share_enabled),
      token: project.share_token ?? null,
      publicSectionUuids: sections.filter((section) => toBool(section.public_visible)).map((section) => section.uuid),
    };
  }

  private async requireLiveShare(token: string, q: Queryable = this.db): Promise<{ project: ProjectRow; repos: Repositories }> {
    const repos = repositories(q);
    const project = await repos.projects.findByShareToken(token);
    if (!project) throw new NotFoundError("Shared project");
    return { project, repos };
  }

  private async requirePublicTask(token: string, taskUuid: string, q: Queryable = this.db) {
    const { project, repos } = await this.requireLiveShare(token, q);
    const task = await repos.tasks.findByUuid(taskUuid);
    if (!task || task.project_id !== project.id) throw new NotFoundError("Task");
    const section = await repos.sections.findById(task.section_id);
    if (!section || !toBool(section.public_visible)) throw new NotFoundError("Task");
    return { project, task, section, repos };
  }

  private async presentSections(repos: Repositories, rows: SectionRow[]): Promise<ChecklistSection[]> {
    const sections = rows.map(toSection);
    if (rows.length === 0) return sections;
    const refs = await repos.references.listBySectionIds(rows.map((row) => row.id));
    const bySection = new Map<string, SectionReference[]>();
    for (const row of refs) {
      const list = bySection.get(row.section_uuid) ?? [];
      list.push(toSectionReference(row));
      bySection.set(row.section_uuid, list);
    }
    return sections.map((section) => ({ ...section, references: bySection.get(section.uuid) ?? [] }));
  }

  private async publicPhases(repos: Repositories, projectId: number, sections: SectionRow[]): Promise<Phase[]> {
    const wanted = new Set(sections.map((section) => section.phase_uuid).filter((uuid): uuid is string => Boolean(uuid)));
    if (wanted.size === 0) return [];
    return (await repos.phases.listByProject(projectId)).filter((row) => wanted.has(row.uuid)).map(toPhase);
  }

  private statsFromTasks(tasks: Task[], sectionCount: number) {
    const today = new Date().toISOString().slice(0, 10);
    const completed = tasks.filter((task) => (RESOLVED_TASK_STATUSES as readonly string[]).includes(task.status)).length;
    const overdue = tasks.filter((task) => task.dueDate && task.dueDate < today && !(RESOLVED_TASK_STATUSES as readonly string[]).includes(task.status)).length;
    return {
      project_id: 0,
      total_tasks: tasks.length,
      completed_tasks: completed,
      overdue_tasks: overdue,
      section_count: sectionCount,
    };
  }
}
