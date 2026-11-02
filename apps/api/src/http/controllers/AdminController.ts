import type { Request, Response } from "express";
import type { AdminService } from "../../domain/services/AdminService.ts";
import { requireAuth } from "../context.ts";
import { ok, okPage } from "../response.ts";
import { adminProductivityQuerySchema, adminProjectQuerySchema, adminUpdateUserSchema, adminUserQuerySchema, pageQuerySchema, parse, uuid } from "../validate.ts";

/** Admin-only endpoints. The role check lives in `AdminService` so it cannot be skipped. */
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  stats = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.admin.stats(actor));
  };

  productivity = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.admin.productivity(actor, parse(adminProductivityQuerySchema, req.query)));
  };

  listUsers = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    okPage(res, await this.admin.listUsers(actor, parse(adminUserQuerySchema, req.query)));
  };

  updateUser = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(adminUpdateUserSchema, req.body);
    ok(res, await this.admin.updateUser(actor, parse(uuid, req.params.userUuid), input));
  };

  disableUser = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.admin.setUserDisabled(actor, parse(uuid, req.params.userUuid), true));
  };

  enableUser = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.admin.setUserDisabled(actor, parse(uuid, req.params.userUuid), false));
  };

  revokeUserSessions = async (req: Request, res: Response) => {
    const { actor, sessionId } = requireAuth(req);
    await this.admin.revokeUserSessions(actor, sessionId, parse(uuid, req.params.userUuid));
    ok(res, null);
  };

  sendPasswordReset = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    await this.admin.sendPasswordReset(actor, parse(uuid, req.params.userUuid));
    ok(res, null, 202);
  };

  listProjects = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    okPage(res, await this.admin.listProjects(actor, parse(adminProjectQuerySchema, req.query)));
  };

  restoreProject = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.admin.restoreProject(actor, parse(uuid, req.params.projectUuid)));
  };

  listAudit = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    okPage(res, await this.admin.listAudit(actor, parse(pageQuerySchema, req.query)));
  };
}
