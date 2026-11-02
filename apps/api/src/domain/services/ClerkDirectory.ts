import { createClerkClient } from "@clerk/express";

/**
 * The slice of Clerk's Backend API this application needs, behind one
 * interface so the rest of the code (and the tests) never touch the SDK.
 */

export interface ClerkIdentity {
  clerkUserId: string;
  /** Primary e-mail address, lower-cased; null when the Clerk user has none. */
  email: string | null;
  /** Display name assembled from first/last name; null when both are empty. */
  name: string | null;
}

export interface ClerkDirectory {
  getUser(clerkUserId: string): Promise<ClerkIdentity | null>;
  findUserByEmail(email: string): Promise<ClerkIdentity | null>;
  /** Create a Clerk user for an existing local account; `externalId` carries our public uuid. */
  createUser(input: { externalId: string; email: string; name: string }): Promise<ClerkIdentity>;
  /** End every Clerk session of the user (admin "revoke sessions" / "disable account"). */
  revokeSessions(clerkUserId: string): Promise<void>;
}

/** Splits "Maya Santos" into Clerk's first/last name fields. */
export function splitName(name: string): { firstName: string; lastName: string | undefined } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: undefined };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

type ClerkClient = ReturnType<typeof createClerkClient>;
type ClerkUser = Awaited<ReturnType<ClerkClient["users"]["getUser"]>>;

function toIdentity(user: ClerkUser): ClerkIdentity {
  const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return { clerkUserId: user.id, email: primary ? primary.emailAddress.toLowerCase() : null, name: name || null };
}

/** Production implementation over `@clerk/backend` (re-exported by `@clerk/express`). */
export class ClerkBackendDirectory implements ClerkDirectory {
  private readonly client: ClerkClient;

  constructor(options: { secretKey: string; publishableKey: string }) {
    this.client = createClerkClient(options);
  }

  async getUser(clerkUserId: string): Promise<ClerkIdentity | null> {
    try {
      return toIdentity(await this.client.users.getUser(clerkUserId));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<ClerkIdentity | null> {
    const { data } = await this.client.users.getUserList({ emailAddress: [email.toLowerCase()], limit: 1 });
    return data[0] ? toIdentity(data[0]) : null;
  }

  async createUser(input: { externalId: string; email: string; name: string }): Promise<ClerkIdentity> {
    const { firstName, lastName } = splitName(input.name);
    const user = await this.client.users.createUser({
      externalId: input.externalId,
      emailAddress: [input.email.toLowerCase()],
      firstName: firstName || undefined,
      lastName,
      // Existing scrypt hashes are not a Clerk import format; users set a new password (or use another factor) on first sign-in.
      skipPasswordRequirement: true,
    });
    return toIdentity(user);
  }

  async revokeSessions(clerkUserId: string): Promise<void> {
    const { data } = await this.client.sessions.getSessionList({ userId: clerkUserId, status: "active", limit: 100 });
    await Promise.all(data.map((s) => this.client.sessions.revokeSession(s.id)));
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: number }).status === 404;
}
