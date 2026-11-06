import type { Request, Response } from "express";
import type { ActivityService } from "../../domain/services/ActivityService.ts";
import type { ChecklistService } from "../../domain/services/ChecklistService.ts";
import type { ProjectService } from "../../domain/services/ProjectService.ts";
import { requireAuth } from "../context.ts";
import { ok, okPage } from "../response.ts";
import { activityQuerySchema, bulkUpdateTaskStatusSchema, createPhaseSchema, createProjectSchema, createSectionSchema, createTaskSchema, parse, reorderPhasesSchema, reorderSectionsSchema, reorderTasksSchema, updateProjectSchema, uuid } from "../validate.ts";

export class ProjectController {
  constructor(
    private readonly projects: ProjectService,
    private readonly checklist: ChecklistService,
    private readonly activity: ActivityService,
  ) {}

  list = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.projects.list(actor));
  };

  create = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(createProjectSchema, req.body);
    ok(res, await this.projects.create(actor, input), 201);
  };

  show = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.projects.get(actor, parse(uuid, req.params.projectUuid)));
  };

  update = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updateProjectSchema, req.body);
    ok(res, await this.projects.update(actor, parse(uuid, req.params.projectUuid), input));
  };

  remove = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.projects.delete(actor, parse(uuid, req.params.projectUuid));
    ok(res, null);
  };

  reorderSections = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(reorderSectionsSchema, req.body);
    ok(res, await this.checklist.reorderSections(actor, parse(uuid, req.params.projectUuid), input));
  };

  listSections = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.checklist.listSections(actor, parse(uuid, req.params.projectUuid)));
  };

  createSection = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(createSectionSchema, req.body);
    ok(res, await this.checklist.createSection(actor, parse(uuid, req.params.projectUuid), input), 201);
  };

  listPhases = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.checklist.listPhases(actor, parse(uuid, req.params.projectUuid)));
  };

  createPhase = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(createPhaseSchema, req.body);
    ok(res, await this.checklist.createPhase(actor, parse(uuid, req.params.projectUuid), input), 201);
  };

  reorderPhases = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(reorderPhasesSchema, req.body);
    ok(res, await this.checklist.reorderPhases(actor, parse(uuid, req.params.projectUuid), input));
  };

  listTasks = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.checklist.listTasks(actor, parse(uuid, req.params.projectUuid)));
  };

  createTask = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(createTaskSchema, req.body);
    ok(res, await this.checklist.createTask(actor, parse(uuid, req.params.projectUuid), input), 201);
  };

  reorderTasks = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(reorderTasksSchema, req.body);
    ok(res, await this.checklist.reorderTasks(actor, parse(uuid, req.params.projectUuid), input));
  };

  bulkUpdateTaskStatus = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(bulkUpdateTaskStatusSchema, req.body);
    ok(res, await this.checklist.bulkUpdateTaskStatus(actor, parse(uuid, req.params.projectUuid), input));
  };

  activityFeed = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const query = parse(activityQuerySchema, req.query);
    // Paged mode is opt-in so the original `?project=&limit=` contract keeps working.
    if (query.page !== undefined || query.perPage !== undefined || query.type !== undefined) {
      okPage(res, await this.activity.page(actor, query));
      return;
    }
    ok(res, await this.activity.list(actor, query.project, query.limit));
  };
}
