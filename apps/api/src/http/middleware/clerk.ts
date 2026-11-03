import { authenticateRequest, createClerkClient, verifyToken } from "@clerk/express";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ClerkAuthService } from "../../domain/services/ClerkAuthService.ts";
import { requestMeta } from "../context.ts";
import { readCookie } from "./session.ts";

/** Verified Clerk principal on a request, or null when it carries no valid Clerk session token. */
export interface ClerkPrincipal {
  clerkUserId: string;
  clerkSessionId: string;
}

/** Token verification behind an interface so tests can substitute a deterministic verifier. */
export interface ClerkTokenVerifier {
  verify(req: Request): Promise<ClerkPrincipal | null>;
}

export interface ClerkJwtVerifierOptions {
  secretKey: string;
  publishableKey: string;
  /** PEM public key for networkless verification; empty means fetch the JWKS with the secret key. */
  jwtKey?: string;
  /** Origins allowed as the token's `azp` (the web app's URL and the CORS origins). */
  authorizedParties: string[];
  /** Allowed server clock drift when checking `nbf`/`exp`. */
  clockSkewMs?: number;
  /** Receives operator-facing hints (e.g. "server clock is off"); defaults to console.error. */
  log?: (message: string) => void;
}

/** Verification failures caused by the clock rather than by the token: worth a hint in the server log. */
const CLOCK_REASONS = new Set(["token-not-active-yet", "token-expired", "token-iat-in-the-future"]);
const CLOCK_HINT_INTERVAL_MS = 60_000;

/** Clerk's Frontend API host is base64-encoded (with a trailing `$`) inside the publishable key. */
export function frontendApiFromPublishableKey(publishableKey: string): string | null {
  const match = /^pk_(?:test|live)_(.+)$/.exec(publishableKey.trim());
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    return decoded.endsWith("$") ? decoded.slice(0, -1) : null;
  } catch {
    return null;
  }
}

/** The raw session token a browser sent: the `Authorization: Bearer …` header, or Clerk's same-origin `__session` cookie. */
export function readClerkToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (match) return match[1];
  }
  return readCookie(req, "__session");
}

/**
 * Verifies the session token with `@clerk/backend`. Two paths:
 *
 * - `jwtKey` set (recommended): the token is verified locally against the
 *   instance's public key — no network call, no JWKS cache to warm up — and
 *   its issuer must be the Frontend API encoded in the publishable key.
 * - otherwise the SDK's request authenticator fetches the JWKS with the secret
 *   key. We call it directly instead of mounting `clerkMiddleware()` because
 *   that middleware stores its result on `req.auth`, which this API already
 *   uses for its own `AuthContext`.
 *
 * Both paths reject tokens whose `azp` is not one of `authorizedParties`.
 */
export class ClerkJwtVerifier implements ClerkTokenVerifier {
  private readonly clerkClient: ReturnType<typeof createClerkClient>;
  private readonly issuer: string | null;
  private readonly log: (message: string) => void;
  private lastClockHintAt = 0;

  constructor(private readonly options: ClerkJwtVerifierOptions) {
    this.clerkClient = createClerkClient({ secretKey: options.secretKey, publishableKey: options.publishableKey });
    const frontendApi = frontendApiFromPublishableKey(options.publishableKey);
    this.issuer = frontendApi ? `https://${frontendApi}` : null;
    this.log = options.log ?? ((m) => console.error(m));
  }

  /**
   * A token that is only "not yet valid" or "expired" usually means this
   * server's clock is wrong, not that the user is unauthorised. Say so once a
   * minute so the operator can find it without decoding JWTs.
   */
  private noteClockProblem(reason: unknown, message: unknown): void {
    if (typeof reason !== "string" || !CLOCK_REASONS.has(reason)) return;
    const now = Date.now();
    if (now - this.lastClockHintAt < CLOCK_HINT_INTERVAL_MS) return;
    this.lastClockHintAt = now;
    this.log(
      `[clerk] session token rejected (${reason}): ${String(message)} — the server clock is probably off. ` +
        `Sync the system time; CLERK_CLOCK_SKEW_MS (currently ${this.options.clockSkewMs ?? "SDK default"}) only papers over small drift.`,
    );
  }

  async verify(req: Request): Promise<ClerkPrincipal | null> {
    return this.options.jwtKey ? this.verifyLocally(req) : this.verifyWithJwks(req);
  }

  private async verifyLocally(req: Request): Promise<ClerkPrincipal | null> {
    const token = readClerkToken(req);
    if (!token) return null;
    let claims: { iss?: unknown; sub?: unknown; sid?: unknown };
    try {
      // Throws a TokenVerificationError for anything not signed by the instance key, expired, or minted for another origin.
      claims = await verifyToken(token, { jwtKey: this.options.jwtKey, authorizedParties: this.options.authorizedParties, clockSkewInMs: this.options.clockSkewMs });
    } catch (error) {
      const { reason, message } = (error ?? {}) as { reason?: unknown; message?: unknown };
      this.noteClockProblem(reason, message);
      return null;
    }
    if (this.issuer && claims.iss !== this.issuer) return null;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.sid !== "string" || !claims.sid) return null;
    return { clerkUserId: claims.sub, clerkSessionId: claims.sid };
  }

  private async verifyWithJwks(req: Request): Promise<ClerkPrincipal | null> {
    const state = await authenticateRequest({
      clerkClient: this.clerkClient,
      request: req,
      options: {
        secretKey: this.options.secretKey,
        publishableKey: this.options.publishableKey,
        authorizedParties: this.options.authorizedParties,
        clockSkewInMs: this.options.clockSkewMs,
        acceptsToken: "session_token",
      },
    });
    if (state.status !== "signed-in") {
      this.noteClockProblem(state.reason, state.message);
      this.log(`[clerk] session not accepted (${String(state.status)}/${String(state.reason ?? "")}): ${String(state.message ?? "")}`);
      return null;
    }
    const auth = state.toAuth();
    if (!auth.userId || !auth.sessionId) return null;
    return { clerkUserId: auth.userId, clerkSessionId: auth.sessionId };
  }
}

/**
 * Clerk counterpart of `sessionMiddleware`: resolves the verified Clerk
 * session into `req.auth`. Like the cookie version it never rejects by
 * itself; a disabled or unknown account is noted on `req.authProblem` so
 * `requireAuth()` can answer with a specific code instead of a bare 401.
 */
export function clerkSessionMiddleware(verifier: ClerkTokenVerifier, clerkAuth: ClerkAuthService): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const principal = await verifier.verify(req);
      if (principal) {
        const resolved = await clerkAuth.resolve(principal, requestMeta(req));
        if ("problem" in resolved) req.authProblem = resolved.problem;
        else req.auth = resolved;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
