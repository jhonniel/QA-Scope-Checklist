import type { Request, Response } from "express";
import type { ChecklistService } from "../../domain/services/ChecklistService.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { parse, updateSectionSchema, uuid } from "../validate.ts";

export class SectionController {
  constructor(private readonly checklist: ChecklistService) {}

  update = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updateSectionSchema, req.body);
    ok(res, await this.checklist.updateSection(actor, parse(uuid, req.params.sectionUuid), input));
  };

  remove = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.checklist.deleteSection(actor, parse(uuid, req.params.sectionUuid));
    ok(res, null);
  };
}
