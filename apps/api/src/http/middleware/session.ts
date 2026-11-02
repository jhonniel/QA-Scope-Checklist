import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Config } from "../../config.ts";
import type { AuthService } from "../../domain/services/AuthService.ts";

/** Minimal cookie parsing — one header, no dependency. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: Response, config: Config, token: string): void {
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.session.secureCookie,
    path: "/",
    maxAge: config.session.ttlDays * 86_400_000,
  });
}

export function clearSessionCookie(res: Response, config: Config): void {
  res.clearCookie(config.session.cookieName, { httpOnly: true, sameSite: "lax", secure: config.session.secureCookie, path: "/" });
}

/**
 * Resolves the session cookie into `req.auth`. Never rejects by itself —
 * controllers call `requireAuth(req)` so public endpoints can share the
 * middleware.
 */
export function sessionMiddleware(auth: AuthService, config: Config): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req, config.session.cookieName);
      if (token) {
        const resolved = await auth.resolve(token);
        if (resolved) req.auth = resolved;
        else clearSessionCookie(res, config);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
