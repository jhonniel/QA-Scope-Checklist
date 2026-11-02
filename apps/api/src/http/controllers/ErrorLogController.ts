import type { Request, Response } from "express";
import type { ErrorLogService } from "../../domain/services/ErrorLogService.ts";
import { requestMeta, requireAuth } from "../context.ts";
import { ok, okPage } from "../response.ts";
import { adminErrorQuerySchema, clientErrorReportSchema, parse, uuid } from "../validate.ts";

/** Client error intake (any caller, rate limited) and the admin-only error log. */
export class ErrorLogController {
  constructor(private readonly errors: ErrorLogService) {}

  /** `POST /errors` — the web app reports a crash. Always 202; the report never affects the caller. */
  report = async (req: Request, res: Response) => {
    const input = parse(clientErrorReportSchema, req.body);
    await this.errors.reportFromClient(req.auth?.actor ?? null, input, { userAgent: requestMeta(req).userAgent });
    ok(res, null, 202);
  };

  list = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    okPage(res, await this.errors.list(actor, parse(adminErrorQuerySchema, req.query)));
  };

  show = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.errors.show(actor, parse(uuid, req.params.errorUuid)));
  };
}
