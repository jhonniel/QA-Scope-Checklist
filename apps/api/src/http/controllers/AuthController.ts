import type { Request, Response } from "express";
import type { Config } from "../../config.ts";
import type { AuthService } from "../../domain/services/AuthService.ts";
import { requestMeta, requireAuth } from "../context.ts";
import { clearSessionCookie, setSessionCookie } from "../middleware/session.ts";
import { ok } from "../response.ts";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, parse, registerSchema, resetPasswordSchema, updateProfileSchema } from "../validate.ts";

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: Config,
  ) {}

  register = async (req: Request, res: Response) => {
    const input = parse(registerSchema, req.body);
    const session = await this.auth.register(input, requestMeta(req));
    setSessionCookie(res, this.config, session.token);
    ok(res, session.user, 201);
  };

  login = async (req: Request, res: Response) => {
    const input = parse(loginSchema, req.body);
    const session = await this.auth.login(input, requestMeta(req));
    setSessionCookie(res, this.config, session.token);
    ok(res, session.user);
  };

  logout = async (req: Request, res: Response) => {
    if (req.auth) await this.auth.logout(req.auth.sessionId);
    clearSessionCookie(res, this.config);
    ok(res, null);
  };

  me = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    ok(res, await this.auth.currentUser(actor));
  };

  updateProfile = async (req: Request, res: Response) => {
    const { actor } = requireAuth(req);
    const input = parse(updateProfileSchema, req.body);
    ok(res, await this.auth.updateProfile(actor, input));
  };

  changePassword = async (req: Request, res: Response) => {
    const { actor, sessionId } = requireAuth(req);
    const input = parse(changePasswordSchema, req.body);
    await this.auth.changePassword(actor, sessionId, input);
    ok(res, null);
  };

  forgotPassword = async (req: Request, res: Response) => {
    const input = parse(forgotPasswordSchema, req.body);
    await this.auth.requestPasswordReset(input.email);
    ok(res, null, 202);
  };

  resetPassword = async (req: Request, res: Response) => {
    const input = parse(resetPasswordSchema, req.body);
    await this.auth.resetPassword(input);
    ok(res, null);
  };
}
