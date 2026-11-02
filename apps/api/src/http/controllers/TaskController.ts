import type { Request, Response } from "express";
import type { ChecklistService } from "../../domain/services/ChecklistService.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { addCommentSchema, parse, updateTaskSchema, uuid } from "../validate.ts";

export class TaskController {
  constructor(private readonly checklist: ChecklistService) {}

  update = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updateTaskSchema, req.body);
    ok(res, await this.checklist.updateTask(actor, parse(uuid, req.params.taskUuid), input));
  };

  remove = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.checklist.deleteTask(actor, parse(uuid, req.params.taskUuid));
    ok(res, null);
  };

  listComments = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.checklist.listComments(actor, parse(uuid, req.params.taskUuid)));
  };

  addComment = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(addCommentSchema, req.body);
    ok(res, await this.checklist.addComment(actor, parse(uuid, req.params.taskUuid), input.body), 201);
  };
}
