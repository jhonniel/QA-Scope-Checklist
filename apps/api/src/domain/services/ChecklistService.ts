import {
  defaultPhaseColor,
  type ChecklistSection,
  type CreatePhaseInput,
  type CreateSectionInput,
  type CreateSectionReferenceInput,
  type CreateTaskInput,
  type SectionReference,
  type Phase,
  type ReorderPhasesInput,
  type ReorderSectionsInput,
  type ReorderTasksInput,
  type Task,
  type TaskComment,
  type UpdatePhaseInput,
  type UpdateSectionInput,
  type UpdateTaskInput,
} from "@scope/contracts";
import type { Database, Queryable } from "../../db/database.ts";
import { nowSql } from "../../db/database.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import { toComment, toPhase, toSection, toSectionReference, toTask, type Actor, type SectionRow, type TaskRow } from "../models.ts";
import { repositories, type Repositories } from "../repositories/index.ts";
import type { TaskPatch } from "../repositories/TaskRepository.ts";
import { assertCanEdit, type ProjectService } from "./ProjectService.ts";

/**
 * Sections, tasks and comments. Every method authorizes through
 * `ProjectService` first, then performs the change and writes the matching
 * activity entry in the same transaction.
 */
export class ChecklistService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
  ) {}

  // ---- sections -----------------------------------------------------------

  async listSections(actor: Actor, projectUuid: string): Promise<ChecklistSection[]> {
    const { project } = await this.projects.requireViewable(actor, projectUuid);
    const repos = repositories(this.db);
    return this.presentSections(repos, await repos.sections.listByProject(project.id));
  }

  async createSection(actor: Actor, projectUuid: string, input: CreateSectionInput): Promise<ChecklistSection> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const section = await repos.sections.create({
        projectId: project.id,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind ?? "scope",
        phaseId: await this.resolvePhaseId(repos, project.id, input.phaseUuid),
        revisionDate: input.revisionDate ?? null,
        position: await repos.sections.nextPosition(project.id),
      });
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "section.created", subject: section.title, meta: { kind: section.kind } });
      if (input.reference) {
        await repos.references.create({
          sectionId: section.id,
          authorId: actor.id,
          kind: input.reference.kind,
          body: input.reference.body,
          title: input.reference.title ?? null,
        });
        await repos.activity.record({
          projectId: project.id,
          actorId: actor.id,
          action: input.reference.kind === "link" ? "section.link_added" : "section.note_added",
          subject: section.title,
        });
      }
      await repos.projects.touch(project.id);
      return this.presentSection(repos, section);
    });
  }

  async updateSection(actor: Actor, sectionUuid: string, input: UpdateSectionInput): Promise<ChecklistSection> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { section, projectId } = await this.requireEditableSection(actor, sectionUuid, tx);
      const updated = await repos.sections.update(section.id, {
        title: input.title,
        description: input.description,
        kind: input.kind,
        phaseId: input.phaseUuid === undefined ? undefined : await this.resolvePhaseId(repos, projectId, input.phaseUuid),
        revisionDate: input.revisionDate,
      });
      await repos.activity.record({ projectId, actorId: actor.id, action: "section.updated", subject: updated.title, meta: input.kind && input.kind !== section.kind ? { kind: input.kind } : undefined });
      await repos.projects.touch(projectId);
      return this.presentSection(repos, updated);
    });
  }

  /** Soft-deletes the section and its tasks. A project always keeps at least one section. */
  async deleteSection(actor: Actor, sectionUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { section, projectId } = await this.requireEditableSection(actor, sectionUuid, tx);
      const remaining = await repos.sections.listByProject(projectId);
      if (remaining.length <= 1) throw new ConflictError("A project needs at least one scope or revision. Rename this one instead.");
      const taskCount = await repos.sections.softDelete(section.id);
      await repos.activity.record({ projectId, actorId: actor.id, action: "section.deleted", subject: section.title, meta: { taskCount } });
      await repos.projects.touch(projectId);
    });
  }

  async reorderSections(actor: Actor, projectUuid: string, input: ReorderSectionsInput): Promise<ChecklistSection[]> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const ids = await repos.sections.idsForUuids(project.id, input.orderedSectionUuids);
      await repos.sections.reorder(ids);
      await repos.projects.touch(project.id);
      return this.presentSections(repos, await repos.sections.listByProject(project.id));
    });
  }

  // ---- phases -------------------------------------------------------------

  async listPhases(actor: Actor, projectUuid: string): Promise<Phase[]> {
    const { project } = await this.projects.requireViewable(actor, projectUuid);
    return (await repositories(this.db).phases.listByProject(project.id)).map(toPhase);
  }

  async createPhase(actor: Actor, projectUuid: string, input: CreatePhaseInput): Promise<Phase> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const position = await repos.phases.nextPosition(project.id);
      const phase = await repos.phases.create({
        projectId: project.id,
        title: input.title,
        color: input.color ?? defaultPhaseColor(position),
        position,
      });
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "phase.created", subject: phase.title });
      await repos.projects.touch(project.id);
      return toPhase(phase);
    });
  }

  async updatePhase(actor: Actor, phaseUuid: string, input: UpdatePhaseInput): Promise<Phase> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { phase, projectId } = await this.requireEditablePhase(actor, phaseUuid, tx);
      const updated = await repos.phases.update(phase.id, input);
      await repos.activity.record({ projectId, actorId: actor.id, action: "phase.updated", subject: updated.title });
      await repos.projects.touch(projectId);
      return toPhase(updated);
    });
  }

  async deletePhase(actor: Actor, phaseUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { phase, projectId } = await this.requireEditablePhase(actor, phaseUuid, tx);
      await repos.phases.softDelete(phase.id);
      await repos.activity.record({ projectId, actorId: actor.id, action: "phase.deleted", subject: phase.title });
      await repos.projects.touch(projectId);
    });
  }

  async reorderPhases(actor: Actor, projectUuid: string, input: ReorderPhasesInput): Promise<Phase[]> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const ids = await repos.phases.idsForUuids(project.id, input.orderedPhaseUuids);
      await repos.phases.reorder(ids);
      await repos.projects.touch(project.id);
      return (await repos.phases.listByProject(project.id)).map(toPhase);
    });
  }

  // ---- tasks --------------------------------------------------------------

  async listTasks(actor: Actor, projectUuid: string): Promise<Task[]> {
    const { project } = await this.projects.requireViewable(actor, projectUuid);
    return (await repositories(this.db).tasks.listByProject(project.id)).map(toTask);
  }

  async createTask(actor: Actor, projectUuid: string, input: CreateTaskInput): Promise<Task> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const section = await repos.sections.findByUuid(input.sectionUuid);
      if (!section || section.project_id !== project.id) throw new ValidationError([{ field: "sectionUuid", message: "The scope does not belong to this project." }]);
      const assigneeId = await this.resolveAssignee(repos, project.id, input.assigneeUuid ?? null);
      const task = await repos.tasks.create({
        projectId: project.id,
        sectionId: section.id,
        title: input.title,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        priority: input.priority ?? "medium",
        assigneeId,
        position: await repos.tasks.nextPosition(section.id),
      });
      await repos.activity.record({ projectId: project.id, actorId: actor.id, action: "task.created", subject: task.title });
      await this.refreshCompletion(repos, project.id, actor);
      await repos.projects.touch(project.id);
      return toTask(task);
    });
  }

  async updateTask(actor: Actor, taskUuid: string, input: UpdateTaskInput): Promise<Task> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { task, projectId } = await this.requireEditableTask(actor, taskUuid, tx);
      const patch: TaskPatch = {};
      const log = (action: Parameters<Repositories["activity"]["record"]>[0]["action"], meta?: Record<string, unknown>) =>
        repos.activity.record({ projectId, actorId: actor.id, action, subject: input.title?.trim() || task.title, meta: meta ?? null });

      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
      if (input.priority !== undefined) patch.priority = input.priority;

      if (input.assigneeUuid !== undefined) {
        patch.assigneeId = await this.resolveAssignee(repos, projectId, input.assigneeUuid);
        if (input.assigneeUuid) {
          const user = await repos.users.findByUuid(input.assigneeUuid);
          await log("task.assigned", { assignee: user?.name ?? null });
        }
      }

      if (input.sectionUuid !== undefined && input.sectionUuid !== task.section_uuid) {
        const section = await repos.sections.findByUuid(input.sectionUuid);
        if (!section || section.project_id !== projectId) throw new ValidationError([{ field: "sectionUuid", message: "The scope does not belong to this project." }]);
        patch.sectionId = section.id;
        patch.position = await repos.tasks.nextPosition(section.id);
      }

      if (input.status !== undefined && input.status !== task.status) {
        patch.status = input.status;
        await log("task.status_changed", { from: task.status, to: input.status });
      }

      // "Checked by" boxes: the server stamps the acting user and time.
      const state = (await repos.tasks.checkState(task.id))!;
      if (input.developerChecked !== undefined && input.developerChecked !== (state.developer_checked_by !== null)) {
        patch.developerCheck = input.developerChecked ? { userId: actor.id, at: nowSql() } : null;
        await log(input.developerChecked ? "task.checked" : "task.unchecked", { side: "developer" });
      }
      if (input.clientChecked !== undefined && input.clientChecked !== (state.client_checked_by !== null)) {
        patch.clientCheck = input.clientChecked ? { userId: actor.id, at: nowSql() } : null;
        await log(input.clientChecked ? "task.checked" : "task.unchecked", { side: "client" });
      }

      const onlyFieldEdits = patch.status === undefined && patch.developerCheck === undefined && patch.clientCheck === undefined && patch.assigneeId === undefined;
      if (onlyFieldEdits && Object.keys(patch).length > 0) await log("task.updated");

      const updated = await repos.tasks.update(task.id, patch);
      if (patch.status !== undefined || patch.sectionId !== undefined) await this.refreshCompletion(repos, projectId, actor);
      await repos.projects.touch(projectId);
      return toTask(updated);
    });
  }

  async deleteTask(actor: Actor, taskUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { task, projectId } = await this.requireEditableTask(actor, taskUuid, tx);
      await repos.tasks.softDelete(task.id);
      await repos.activity.record({ projectId, actorId: actor.id, action: "task.deleted", subject: task.title });
      await this.refreshCompletion(repos, projectId, actor);
      await repos.projects.touch(projectId);
    });
  }

  async reorderTasks(actor: Actor, projectUuid: string, input: ReorderTasksInput): Promise<Task[]> {
    return this.db.transaction(async (tx) => {
      const { project } = await this.projects.requireEditable(actor, projectUuid, tx);
      const repos = repositories(tx);
      const section = await repos.sections.findByUuid(input.sectionUuid);
      if (!section || section.project_id !== project.id) throw new ValidationError([{ field: "sectionUuid", message: "The scope does not belong to this project." }]);
      const ids = await repos.tasks.idsForUuids(project.id, input.orderedTaskUuids);
      await repos.tasks.reorder(section.id, ids);
      await this.refreshCompletion(repos, project.id, actor);
      await repos.projects.touch(project.id);
      return (await repos.tasks.listBySection(section.id)).map(toTask);
    });
  }

  // ---- section notes & links ----------------------------------------------

  async listSectionReferences(actor: Actor, sectionUuid: string): Promise<SectionReference[]> {
    const { section } = await this.requireViewableSection(actor, sectionUuid, this.db);
    return (await repositories(this.db).references.listBySectionIds([section.id])).map(toSectionReference);
  }

  async addSectionReference(actor: Actor, sectionUuid: string, input: CreateSectionReferenceInput): Promise<SectionReference> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { section, projectId } = await this.requireEditableSection(actor, sectionUuid, tx);
      const row = await repos.references.create({
        sectionId: section.id,
        authorId: actor.id,
        kind: input.kind,
        body: input.body,
        title: input.title ?? null,
      });
      await repos.activity.record({
        projectId,
        actorId: actor.id,
        action: input.kind === "link" ? "section.link_added" : "section.note_added",
        subject: section.title,
      });
      await repos.projects.touch(projectId);
      return toSectionReference(row);
    });
  }

  async deleteSectionReference(actor: Actor, sectionUuid: string, referenceUuid: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      const { section, projectId } = await this.requireEditableSection(actor, sectionUuid, tx);
      const row = await repos.references.findByUuid(referenceUuid);
      if (!row || row.section_id !== section.id) throw new NotFoundError("Note");
      await repos.references.softDelete(row.id);
      await repos.activity.record({
        projectId,
        actorId: actor.id,
        action: "section.reference_deleted",
        subject: section.title,
        meta: { kind: row.kind },
      });
      await repos.projects.touch(projectId);
    });
  }

  // ---- comments -----------------------------------------------------------

  async listComments(actor: Actor, taskUuid: string): Promise<TaskComment[]> {
    const { task } = await this.requireViewableTask(actor, taskUuid, this.db);
    return (await repositories(this.db).comments.listByTask(task.id)).map(toComment);
  }

  async addComment(actor: Actor, taskUuid: string, body: string): Promise<TaskComment> {
    return this.db.transaction(async (tx) => {
      const repos = repositories(tx);
      // Viewers may comment; only content changes require edit rights.
      const { task, projectId } = await this.requireViewableTask(actor, taskUuid, tx);
      const comment = await repos.comments.create({ taskId: task.id, authorId: actor.id, body });
      await repos.activity.record({ projectId, actorId: actor.id, action: "comment.added", subject: task.title });
      return toComment(comment);
    });
  }

  // ---- helpers ------------------------------------------------------------

  /**
   * After any change to the tasks of a project, stamp the sections that just
   * reached 100% (and un-stamp those that fell below), recording each
   * completion in the activity log so the date survives later reopenings.
   */
  private async refreshCompletion(repos: Repositories, projectId: number, actor: Actor): Promise<void> {
    const completed = await repos.sections.refreshCompletion(projectId);
    for (const section of completed) {
      await repos.activity.record({ projectId, actorId: actor.id, action: "section.completed", subject: section.title, meta: { kind: section.kind } });
    }
  }

  private async requireViewableTask(actor: Actor, taskUuid: string, q: Queryable): Promise<{ task: TaskRow; projectId: number; access: Awaited<ReturnType<ProjectService["requireViewable"]>>["access"] }> {
    const task = await repositories(q).tasks.findByUuid(taskUuid);
    if (!task) throw new NotFoundError("Task");
    const { access } = await this.projects.requireViewable(actor, task.project_uuid, q);
    return { task, projectId: task.project_id, access };
  }

  private async requireEditableTask(actor: Actor, taskUuid: string, q: Queryable) {
    const result = await this.requireViewableTask(actor, taskUuid, q);
    assertCanEdit(result.access);
    return result;
  }

  private async requireViewableSection(actor: Actor, sectionUuid: string, q: Queryable): Promise<{ section: SectionRow; projectId: number }> {
    const section = await repositories(q).sections.findByUuid(sectionUuid);
    if (!section) throw new NotFoundError("Scope");
    await this.projects.requireViewable(actor, section.project_uuid, q);
    return { section, projectId: section.project_id };
  }

  private async requireEditableSection(actor: Actor, sectionUuid: string, q: Queryable): Promise<{ section: SectionRow; projectId: number }> {
    const section = await repositories(q).sections.findByUuid(sectionUuid);
    if (!section) throw new NotFoundError("Scope");
    await this.projects.requireEditable(actor, section.project_uuid, q);
    return { section, projectId: section.project_id };
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

  private async presentSection(repos: Repositories, row: SectionRow): Promise<ChecklistSection> {
    const [section] = await this.presentSections(repos, [row]);
    return section;
  }

  private async requireEditablePhase(actor: Actor, phaseUuid: string, q: Queryable) {
    const phase = await repositories(q).phases.findByUuid(phaseUuid);
    if (!phase) throw new NotFoundError("Phase");
    await this.projects.requireEditable(actor, phase.project_uuid, q);
    return { phase, projectId: phase.project_id };
  }

  /** `undefined` means leave the current phase; `null` ungroups. */
  private async resolvePhaseId(repos: Repositories, projectId: number, phaseUuid: string | null | undefined): Promise<number | null | undefined> {
    if (phaseUuid === undefined) return undefined;
    if (phaseUuid === null) return null;
    const phase = await repos.phases.findByUuid(phaseUuid);
    if (!phase || phase.project_id !== projectId) throw new ValidationError([{ field: "phaseUuid", message: "The phase does not belong to this project." }]);
    return phase.id;
  }

  /** Assignees must be project members (or null to unassign). */
  private async resolveAssignee(repos: Repositories, projectId: number, assigneeUuid: string | null): Promise<number | null> {
    if (!assigneeUuid) return null;
    const user = await repos.users.findByUuid(assigneeUuid);
    if (!user) throw new ValidationError([{ field: "assigneeUuid", message: "Unknown user." }]);
    const role = await repos.projects.memberRole(projectId, user.id);
    if (!role) throw new ValidationError([{ field: "assigneeUuid", message: "Assignee must be a project member." }]);
    return user.id;
  }
}
