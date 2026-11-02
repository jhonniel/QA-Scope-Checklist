import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { DomainError } from "../../domain/errors.ts";
import { fail } from "../response.ts";

export const notFound: RequestHandler = (_req, res) => {
  fail(res, 404, "not_found", "Endpoint not found.");
};

/** What the error handler hands to the error log for a failed request. */
export interface CaughtError {
  status: number;
  code: string;
  name: string | null;
  message: string;
  stack: string | null;
  method: string;
  path: string;
  actorId: number | null;
  userAgent: string | null;
}

export interface ErrorHandlerOptions {
  /** Server log line for unexpected failures. */
  log: (message: string, error: unknown) => void;
  /** Persist a 5xx for administrators. Must not throw; failures are the recorder's problem. */
  record?: (caught: CaughtError) => Promise<unknown> | unknown;
}

function describe(req: Request, error: unknown, status: number, code: string): CaughtError {
  const err = error instanceof Error ? error : null;
  return {
    status,
    code,
    name: err?.name ?? null,
    message: err?.message ?? (typeof error === "string" ? error : "Unknown error"),
    stack: err?.stack ?? null,
    method: req.method,
    path: req.originalUrl.split("?")[0],
    actorId: req.auth?.actor.id ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

/**
 * Last middleware. Domain errors become their envelope; anything else is a
 * 500 with a generic message — details go to the server log and, when a
 * recorder is wired, to the admin error log. Nothing internal reaches the client.
 */
export function errorHandler(logOrOptions: ErrorHandlerOptions["log"] | ErrorHandlerOptions): ErrorRequestHandler {
  const { log, record } = typeof logOrOptions === "function" ? { log: logOrOptions, record: undefined } : logOrOptions;
  const persist = (req: Request, error: unknown, status: number, code: string) => {
    if (!record) return;
    try {
      void Promise.resolve(record(describe(req, error, status, code))).catch((e) => log("Error log recorder failed", e));
    } catch (e) {
      log("Error log recorder failed", e);
    }
  };

  return (error, req, res, _next) => {
    if (error instanceof DomainError) {
      // Expected outcomes (4xx) are not failures; a domain-level 5xx still is.
      if (error.status >= 500) persist(req, error, error.status, error.code);
      fail(res, error.status, error.code, error.message, error.fields);
      return;
    }
    // Malformed JSON from express.json()
    if (error && typeof error === "object" && (error as { type?: string }).type === "entity.parse.failed") {
      fail(res, 400, "bad_request", "The request body is not valid JSON.");
      return;
    }
    if (error && typeof error === "object" && (error as { type?: string }).type === "entity.too.large") {
      fail(res, 413, "payload_too_large", "The request body is too large.");
      return;
    }
    log("Unhandled error", error);
    persist(req, error, 500, "server_error");
    fail(res, 500, "server_error", "Something went wrong on our side. Please try again.");
  };
}
