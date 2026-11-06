import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Config } from "../../config.ts";
import { ForbiddenError } from "../../domain/errors.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** http(s) origin on loopback or RFC1918 — used so the LAN can reach a workstation. */
export function isLanHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1") return true;
    if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;
    if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

type HeaderRequest = { protocol: string; get(name: string): string | string[] | undefined };

function firstHeader(req: HeaderRequest, name: string): string {
  const value = req.get(name);
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Public origin of this request as the browser sees it (proxy Host + proto). */
export function requestPublicOrigin(req: HeaderRequest): string | null {
  const proto = (firstHeader(req, "x-forwarded-proto") || req.protocol || "http").split(",")[0]?.trim().toLowerCase();
  const host = (firstHeader(req, "x-forwarded-host") || firstHeader(req, "host")).split(",")[0]?.trim();
  if (!proto || !host) return null;
  return `${proto}://${host}`.replace(/\/$/, "");
}

function originPermitted(config: Config, origin: string, req?: HeaderRequest): boolean {
  const normalized = origin.replace(/\/$/, "");
  if (config.allowedOrigins.some((o) => o.replace(/\/$/, "") === normalized)) return true;
  // Same-origin through nginx: Host is the public site even if APP_URL still names an old alias.
  if (req && requestPublicOrigin(req) === normalized) return true;
  // Production on the public internet stays on the allow-list. A workstation
  // (development, tests, or a local docker trial) may also be opened on the LAN.
  if (config.env === "production" && process.env.ALLOW_INSECURE_PRODUCTION !== "true") return false;
  return isLanHttpOrigin(normalized);
}

/**
 * CSRF protection for cookie sessions: state-changing requests must come from
 * an allowed origin. Combined with `SameSite=Lax` cookies this blocks
 * cross-site form posts and fetches. Requests without an Origin header (same
 * origin navigations in some browsers, CLI tools) must carry
 * `X-Requested-With`.
 */
export function originGuard(config: Config): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin) {
      if (!originPermitted(config, origin, req)) return next(new ForbiddenError("Cross-origin request rejected."));
      return next();
    }
    if (req.get("x-requested-with") === "XMLHttpRequest") return next();
    return next(new ForbiddenError("Missing origin."));
  };
}

/** CORS for the configured app origins (only needed when the API is on a different origin). */
export function cors(config: Config): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("origin");
    if (origin && originPermitted(config, origin, req)) {
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
