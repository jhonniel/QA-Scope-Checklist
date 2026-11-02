import type { NextFunction, Request, RequestHandler, Response } from "express";
import { TooManyRequestsError } from "../../domain/errors.ts";

export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
  /** Bucket key; defaults to the client IP (honouring `trust proxy`). */
  key?: (req: Request) => string;
}

/**
 * Fixed-window rate limiter for the public account endpoints (registration,
 * password-reset requests, token redemption). In-process state is enough for
 * a single node; move the buckets to Redis if the API is scaled out. Login
 * guessing is throttled separately per e-mail inside `AuthService`.
 */
export function rateLimit({ max, windowMs, key = (req) => req.ip ?? "unknown" }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let sweepAt = Date.now() + windowMs;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
      sweepAt = now + windowMs;
    }

    const k = key(req);
    let bucket = buckets.get(k);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(k, bucket);
    }
    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return next(new TooManyRequestsError("Too many requests. Please wait a moment and try again."));
    }
    next();
  };
}
