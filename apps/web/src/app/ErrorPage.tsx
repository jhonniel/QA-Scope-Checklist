import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { routes } from "@/app/routes";
import { Button } from "@/design-system";
import { reportClientError } from "@/lib/errorReporting";

/** Vite emits this when a hashed chunk vanished after a new deployment. */
const isStaleChunk = (error: unknown) => error instanceof Error && /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);

/**
 * Route-level error boundary. Rendering errors, loader failures and stale
 * lazy chunks land here instead of a blank screen. Details go to the console
 * and the admin error log — the user sees a plain explanation and a way out.
 */
export function ErrorPage() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);

  const stale = isStaleChunk(error);
  const status = isRouteErrorResponse(error) ? error.status : null;

  useEffect(() => {
    // 404s and stale chunks are not application bugs.
    if (stale || status !== null) return;
    reportClientError(error, { kind: "route" });
  }, [error, stale, status]);
  const title = stale ? "A new version is available" : status === 404 ? "Page not found" : "Something went wrong";
  const description = stale
    ? "The app was updated while you were using it. Reload to get the latest version."
    : status === 404
      ? "The page you are looking for does not exist or has moved."
      : "The page could not be displayed. Your data is safe — try reloading, or go back to the dashboard.";

  return (
    <div role="alert" className="flex min-h-dvh w-full flex-col items-center justify-center gap-5 bg-canvas px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" leadingIcon={<RefreshCw className="size-4" aria-hidden />} onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link to={routes.dashboard()} reloadDocument className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-ink hover:bg-surface-muted">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
