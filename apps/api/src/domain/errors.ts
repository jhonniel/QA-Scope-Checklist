import type { ApiFieldError } from "@scope/contracts";

/**
 * Domain errors carry an HTTP status and a stable machine-readable code so
 * the error middleware can render the API envelope without inspecting
 * messages. Messages are safe to show to end users.
 */
export class DomainError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ApiFieldError[] | undefined;

  constructor(status: number, code: string, message: string, fields?: ApiFieldError[]) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export class ValidationError extends DomainError {
  constructor(fields: ApiFieldError[], message = "Please check the highlighted fields.") {
    super(422, "validation_failed", message, fields);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "You need to sign in to continue.") {
    super(401, "unauthenticated", message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "You do not have permission to do that.") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource = "Resource") {
    super(404, "not_found", `${resource} was not found.`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, fields?: ApiFieldError[]) {
    super(409, "conflict", message, fields);
  }
}

export class TooManyRequestsError extends DomainError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super(429, "too_many_requests", message);
  }
}
