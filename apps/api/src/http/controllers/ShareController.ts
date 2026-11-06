import type { Request, Response } from "express";
import type { ShareService } from "../../domain/services/ShareService.ts";
import { requireAuth } from "../context.ts";
import { ok } from "../response.ts";
import { parse, publicClientCheckSchema, updateProjectShareSchema, uuid } from "../validate.ts";

export class ShareController {
  constructor(private readonly share: ShareService) {}

  settings = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.share.settings(actor, parse(uuid, req.params.projectUuid)));
  };

  update = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.share.update(actor, parse(uuid, req.params.projectUuid), parse(updateProjectShareSchema, req.body)));
  };

  snapshot = async (req: Request, res: Response) => {
    ok(res, await this.share.snapshot(parse(uuid, req.params.token)));
  };

  comments = async (req: Request, res: Response) => {
    ok(res, await this.share.listComments(parse(uuid, req.params.token), parse(uuid, req.params.taskUuid)));
  };

  setClientCheck = async (req: Request, res: Response) => {
    ok(res, await this.share.setClientCheck(parse(uuid, req.params.token), parse(uuid, req.params.taskUuid), parse(publicClientCheckSchema, req.body)));
  };
}
