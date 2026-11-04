import { Router, type RequestHandler } from "express";
import type { Config } from "../config.ts";
import type { Services } from "./context.ts";
import { AdminController } from "./controllers/AdminController.ts";
import { AuthController } from "./controllers/AuthController.ts";
import { ErrorLogController } from "./controllers/ErrorLogController.ts";
import { ExportController } from "./controllers/ExportController.ts";
import { MembershipController } from "./controllers/MembershipController.ts";
import { PhaseController } from "./controllers/PhaseController.ts";
import { ProjectController } from "./controllers/ProjectController.ts";
import { SectionController } from "./controllers/SectionController.ts";
import { TaskController } from "./controllers/TaskController.ts";
import { rateLimit } from "./middleware/rateLimit.ts";
import { fail, ok } from "./response.ts";

/**
 * REST surface. Public identifiers are uuids; internal ids never appear.
 *
 *   GET    /auth/provider            (public: { provider: "session" | "clerk" })
 *   POST   /auth/register            PATCH  /auth/profile
 *   POST   /auth/login               POST   /auth/password
 *   POST   /auth/logout              POST   /auth/forgot-password
 *   GET    /auth/me                  POST   /auth/reset-password
 *   (register/login/password/forgot/reset answer 409 auth_managed_externally when AUTH_PROVIDER=clerk)
 *
 *   GET    /projects                 GET    /projects/:uuid/tasks
 *   POST   /projects                 POST   /projects/:uuid/tasks
 *   GET    /projects/:uuid           POST   /projects/:uuid/tasks/reorder
 *   PATCH  /projects/:uuid           PATCH  /tasks/:uuid
 *   DELETE /projects/:uuid           DELETE /tasks/:uuid
 *   GET    /projects/:uuid/sections  GET    /tasks/:uuid/comments
 *   POST   /projects/:uuid/sections  POST   /tasks/:uuid/comments
 *   POST   /projects/:uuid/sections/reorder
 *   PATCH  /sections/:uuid           GET    /activity?project=&limit=
 *   DELETE /sections/:uuid           GET    /activity?project=&type=&page=&perPage=  (paged; meta)
 *
 *   GET    /projects/:uuid/invitations          GET    /invitations            (mine, pending)
 *   POST   /projects/:uuid/invitations          POST   /invitations/accept-token
 *   DELETE /projects/:uuid/invitations/:uuid    POST   /invitations/:uuid/accept
 *   PATCH  /projects/:uuid/members/:uuid        POST   /invitations/:uuid/decline
 *   DELETE /projects/:uuid/members/:uuid
 *   POST   /projects/:uuid/members/transfer
 *   POST   /projects/:uuid/members/leave
 *
 *   GET    /export-templates                    POST   /projects/:uuid/exports   (→ .docx download)
 *
 *   POST   /errors                              (web app reports a client-side crash; rate limited; 202)
 *
 *   Admin only (403 otherwise):
 *   GET    /admin/stats                         GET    /admin/projects?search=&status=&page=&perPage=
 *   GET    /admin/productivity?period=          POST   /admin/projects/:uuid/restore
 *   GET    /admin/users?search=&role=&status=   GET    /admin/audit?page=&perPage=
 *   PATCH  /admin/users/:uuid                   GET    /admin/errors?source=&search=&page=&perPage=
 *   POST   /admin/users/:uuid/disable | enable | approve | revoke-sessions | password-reset | password
 *   GET    /admin/errors/:uuid
 */
export interface RouterDeps {
  /** Cheap database round-trip for the health check. */
  ping: () => Promise<unknown>;
}

export function buildRouter(services: Services, config: Config, deps: RouterDeps): Router {
  const router = Router();
  const auth = new AuthController(services.auth, config);
  const projects = new ProjectController(services.projects, services.checklist, services.activity);
  const sections = new SectionController(services.checklist);
  const phases = new PhaseController(services.checklist);
  const tasks = new TaskController(services.checklist);
  const membership = new MembershipController(services.membership);
  const exports = new ExportController(services.exports);
  const admin = new AdminController(services.admin);
  const errors = new ErrorLogController(services.errors);

  // Public endpoints that create accounts or send e-mail are rate limited per client address.
  const accountLimiter = rateLimit({ max: 10, windowMs: 15 * 60_000 });
  const tokenLimiter = rateLimit({ max: 20, windowMs: 15 * 60_000 });
  // Client crash reports: generous for a real crash loop, tight enough that nobody can fill the table.
  const errorReportLimiter = rateLimit({ max: 30, windowMs: 10 * 60_000 });

  // Liveness + readiness in one: a failing database answers 503 so orchestrators stop routing here.
  router.get("/health", async (_req, res) => {
    try {
      await deps.ping();
      ok(res, { status: "ok", db: "ok" });
    } catch {
      fail(res, 503, "unavailable", "The database is not reachable.");
    }
  });

  // Which provider the web app should use; public so the SPA can be served from anywhere.
  router.get("/auth/provider", (_req, res) => ok(res, { provider: config.auth.provider }));

  if (config.auth.provider === "clerk") {
    // Credentials live at Clerk: the password endpoints answer 409 instead of silently accepting local passwords.
    const managedByClerk: RequestHandler = (_req, res) => fail(res, 409, "auth_managed_externally", "Sign-in and passwords are managed by Clerk for this deployment.");
    router.post("/auth/register", managedByClerk);
    router.post("/auth/login", managedByClerk);
    router.post("/auth/password", managedByClerk);
    router.post("/auth/forgot-password", managedByClerk);
    router.post("/auth/reset-password", managedByClerk);
  } else {
    router.post("/auth/register", accountLimiter, auth.register);
    router.post("/auth/login", auth.login);
    router.post("/auth/password", auth.changePassword);
    router.post("/auth/forgot-password", accountLimiter, auth.forgotPassword);
    router.post("/auth/reset-password", tokenLimiter, auth.resetPassword);
  }
  // Shared by both providers: under Clerk, logout drops the mirrored session row (the browser ends the Clerk session itself).
  router.post("/auth/logout", auth.logout);
  router.get("/auth/me", auth.me);
  router.patch("/auth/profile", auth.updateProfile);

  router.get("/projects", projects.list);
  router.post("/projects", projects.create);
  router.get("/projects/:projectUuid", projects.show);
  router.patch("/projects/:projectUuid", projects.update);
  router.delete("/projects/:projectUuid", projects.remove);
  router.get("/projects/:projectUuid/sections", projects.listSections);
  router.post("/projects/:projectUuid/sections", projects.createSection);
  router.post("/projects/:projectUuid/sections/reorder", projects.reorderSections);
  router.get("/projects/:projectUuid/phases", projects.listPhases);
  router.post("/projects/:projectUuid/phases", projects.createPhase);
  router.post("/projects/:projectUuid/phases/reorder", projects.reorderPhases);
  router.get("/projects/:projectUuid/tasks", projects.listTasks);
  router.post("/projects/:projectUuid/tasks", projects.createTask);
  router.post("/projects/:projectUuid/tasks/reorder", projects.reorderTasks);

  router.get("/projects/:projectUuid/invitations", membership.listInvitations);
  router.post("/projects/:projectUuid/invitations", membership.invite);
  router.delete("/projects/:projectUuid/invitations/:invitationUuid", membership.revokeInvitation);
  router.post("/projects/:projectUuid/members/transfer", membership.transfer);
  router.post("/projects/:projectUuid/members/leave", membership.leave);
  router.patch("/projects/:projectUuid/members/:memberUuid", membership.updateRole);
  router.delete("/projects/:projectUuid/members/:memberUuid", membership.remove);

  router.post("/projects/:projectUuid/exports", exports.create);
  router.get("/export-templates", exports.templates);

  router.get("/invitations", membership.mine);
  router.post("/invitations/accept-token", tokenLimiter, membership.acceptByToken);
  router.post("/invitations/:invitationUuid/accept", membership.accept);
  router.post("/invitations/:invitationUuid/decline", membership.decline);

  router.patch("/sections/:sectionUuid", sections.update);
  router.delete("/sections/:sectionUuid", sections.remove);
  router.patch("/phases/:phaseUuid", phases.update);
  router.delete("/phases/:phaseUuid", phases.remove);

  router.patch("/tasks/:taskUuid", tasks.update);
  router.delete("/tasks/:taskUuid", tasks.remove);
  router.get("/tasks/:taskUuid/comments", tasks.listComments);
  router.post("/tasks/:taskUuid/comments", tasks.addComment);

  router.get("/activity", projects.activityFeed);

  router.post("/errors", errorReportLimiter, errors.report);

  router.get("/admin/stats", admin.stats);
  router.get("/admin/productivity", admin.productivity);
  router.get("/admin/users", admin.listUsers);
  router.patch("/admin/users/:userUuid", admin.updateUser);
  router.post("/admin/users/:userUuid/disable", admin.disableUser);
  router.post("/admin/users/:userUuid/enable", admin.enableUser);
  router.post("/admin/users/:userUuid/approve", admin.approveUser);
  router.post("/admin/users/:userUuid/revoke-sessions", admin.revokeUserSessions);
  router.post("/admin/users/:userUuid/password-reset", admin.sendPasswordReset);
  router.post("/admin/users/:userUuid/password", admin.setUserPassword);
  router.get("/admin/projects", admin.listProjects);
  router.post("/admin/projects/:projectUuid/restore", admin.restoreProject);
  router.get("/admin/audit", admin.listAudit);
  router.get("/admin/errors", errors.list);
  router.get("/admin/errors/:errorUuid", errors.show);

  return router;
}
