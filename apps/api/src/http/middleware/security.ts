import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Config } from "../../config.ts";
import { ForbiddenError } from "../../domain/errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie sessions: state-changing requests must come from
 * an allowed origin. Combined with `SameSite=Lax` cookies this blocks
 * cross-site form posts and fetches. Requests without an Origin header (same
 * origin navigations in some browsers, CLI tools) must carry
 * `X-Requested-With`.
 */
export function originGuard(config: Config): RequestHandler {
  const allowed = new Set(config.allowedOrigins.map((o) => o.replace(/\/$/, "")));
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin) {
      if (!allowed.has(origin.replace(/\/$/, ""))) return next(new ForbiddenError("Cross-origin request rejected."));
      return next();
    }
    if (req.get("x-requested-with") === "XMLHttpRequest") return next();
    return next(new ForbiddenError("Missing origin."));
  };
}

/** CORS for the configured app origins (only needed when the API is on a different origin). */
export function cors(config: Config): RequestHandler {
  const allowed = new Set(config.allowedOrigins.map((o) => o.replace(/\/$/, "")));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin.replace(/\/$/, ""))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        // Authorization carries the Clerk session token when the API is on another origin.
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, Authorization");
        res.setHeader("Access-Control-Max-Age", "600");
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

/**
 * Conservative response headers for the API. `Cache-Control: no-store` keeps
 * personal data out of shared caches; HSTS is only sent when the deployment
 * declares itself HTTPS (`SESSION_SECURE=true`) so a plain-HTTP dev setup is
 * never pinned.
 */
export function securityHeaders(config: Config): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cache-Control", "no-store");
    if (config.session.secureCookie) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
  };
}

/**
 * Minimal structured request log: method, path, status, duration. Written
 * after the response finishes so the status is known; bodies and query
 * strings are never logged (they can carry tokens and personal data).
 */
export function requestLogger(log: (line: string) => void): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}
