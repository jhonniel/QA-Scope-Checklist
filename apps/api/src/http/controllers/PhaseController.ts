import type { Request, Response } from "express";
import type { ChecklistService } from "../../domain/services/ChecklistService.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { parse, updatePhaseSchema, uuid } from "../validate.ts";

export class PhaseController {
  constructor(private readonly checklist: ChecklistService) {}

  update = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updatePhaseSchema, req.body);
    ok(res, await this.checklist.updatePhase(actor, parse(uuid, req.params.phaseUuid), input));
  };

  remove = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.checklist.deletePhase(actor, parse(uuid, req.params.phaseUuid));
    ok(res, null);
  };
}
