import type { ApiFieldError } from "@scope/contracts";

/**
 * Error raised by every `ScopeApi` implementation. Carries the backend's
 * machine-readable `code`, a user-safe `message` and optional per-field
 * validation messages so forms can show them inline.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ApiFieldError[];

  constructor(status: number, code: string, message: string, fields: ApiFieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** Field errors keyed by field name — convenient for form state. */
  get fieldMap(): Record<string, string> {
    return Object.fromEntries(this.fields.map((f) => [f.field, f.message]));
  }

  static is(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }

  /** Message safe to show the user, with a generic fallback for non-API failures. */
  static message(error: unknown, fallback = "Something went wrong. Please try again."): string {
    return ApiError.is(error) ? error.message : fallback;
  }
}
