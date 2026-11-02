import { api, ApiError } from "@/services/api";

/**
 * Sends client-side crashes to `POST /errors` so administrators can see them
 * under Admin → Errors. Best effort: nothing here may throw, and the same
 * message is reported once per page load so a render loop cannot flood the log.
 */

const MAX_REPORTS_PER_LOAD = 10;
const seen = new Set<string>();
let sent = 0;

/** Vite emits this when a hashed chunk vanished after a deployment — a deployment event, not a bug. */
const isStaleChunk = (message: string) => /dynamically imported module|Loading chunk|Importing a module script failed/i.test(message);

export function reportClientError(error: unknown, context: Record<string, unknown> = {}): void {
  try {
    // API failures are already recorded server-side (5xx) or are expected outcomes (4xx).
    if (ApiError.is(error)) return;
    const err = error instanceof Error ? error : null;
    const message = err?.message ?? (typeof error === "string" ? error : "Unknown error");
    if (!message || isStaleChunk(message)) return;
    const key = `${err?.name ?? ""}:${message}`;
    if (seen.has(key) || sent >= MAX_REPORTS_PER_LOAD) return;
    seen.add(key);
    sent += 1;
    void api
      .reportError({
        message: message.slice(0, 2000),
        name: err?.name,
        stack: err?.stack?.slice(0, 8000),
        path: typeof location !== "undefined" ? location.pathname : undefined,
        context,
      })
      .catch(() => {
        /* reporting must never surface as another error */
      });
  } catch {
    /* ignore */
  }
}

let installed = false;

/** Catches errors that escape React entirely (event handlers, async code, promises). */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message, { kind: "window.error" }));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason, { kind: "unhandledrejection" }));
}
