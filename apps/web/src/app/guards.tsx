import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { AlertTriangle, CheckSquare, ShieldOff } from "lucide-react";
import { Button } from "@/design-system";
import { useExternalAuthStatus, usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { NEXT_PARAM, routes, safeNext } from "./routes";

/** Full-screen placeholder while the session is being resolved on first load. */
function BootSplash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas" aria-busy>
      <span className="flex size-10 animate-pulse items-center justify-center rounded-xl bg-accent text-accent-fg" aria-hidden>
        <CheckSquare className="size-5" strokeWidth={2.5} />
      </span>
    </div>
  );
}

function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <div>
        <h1 className="text-lg font-semibold text-ink">Cannot reach the server</h1>
        <p className="mt-1 text-sm text-ink-muted">Check that the API is running, then try again.</p>
      </div>
      <Button variant="primary" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * Signed in at the identity provider, but the API has no usable account for it
 * (disabled, or a Clerk user without an e-mail). Redirecting to sign-in would
 * loop, so explain and offer the only way out.
 */
function AccountUnavailable() {
  const logout = useAppStore((s) => s.logout);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <ShieldOff className="size-6" aria-hidden />
      </span>
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-ink">This account cannot be used</h1>
        <p className="mt-1 text-sm text-ink-muted">Your sign-in is valid, but no active Scope Checklist account matches it. It may have been disabled — contact an administrator.</p>
      </div>
      <Button variant="secondary" onClick={() => void logout()}>
        Sign out
      </Button>
    </div>
  );
}

/**
 * Wraps authenticated routes. Resolves the session once, then renders the
 * children or redirects to the sign-in page remembering where the user was.
 */
export function RequireAuth() {
  const bootState = useAppStore((s) => s.bootState);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const providerStatus = useExternalAuthStatus();
  const location = useLocation();
  // Clerk: the app may have concluded "nobody is signed in" before Clerk finished signing someone in.
  // Resolve the account once more before deciding the sign-in cannot be used.
  const retried = useRef(false);
  const shouldRetry = usingClerk && bootState === "unauthenticated" && providerStatus === "signed-in" && !retried.current;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (providerStatus !== "signed-in") retried.current = false;
    if (!shouldRetry) return;
    retried.current = true;
    useAppStore.setState({ bootState: "idle" });
    void bootstrap();
  }, [shouldRetry, providerStatus, bootstrap]);

  if (bootState === "idle" || bootState === "loading" || shouldRetry) return <BootSplash />;
  if (bootState === "error") {
    return (
      <BootError
        onRetry={() => {
          useAppStore.setState({ bootState: "idle" });
          void bootstrap();
        }}
      />
    );
  }
  if (bootState === "unauthenticated") {
    // Clerk says signed in, the API says no account: a redirect to /login would bounce straight back here.
    if (usingClerk && providerStatus === "signed-in") return <AccountUnavailable />;
    return <Navigate to={routes.login(location.pathname + location.search)} replace />;
  }
  return <Outlet />;
}

/**
 * Wraps admin-only routes (inside `RequireAuth`). Non-admins are sent to the
 * dashboard; the API enforces the same rule with 403, this only shapes the UI.
 */
export function RequireAdmin() {
  const role = useAppStore((s) => s.currentUser?.role);
  if (role !== "admin") return <Navigate to={routes.dashboard()} replace />;
  return <Outlet />;
}

/** Wraps public auth pages; signed-in users are sent to the app instead. */
export function RedirectIfAuthenticated() {
  const bootState = useAppStore((s) => s.bootState);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const location = useLocation();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (bootState === "idle" || bootState === "loading") return <BootSplash />;
  if (bootState === "ready") {
    const next = safeNext(new URLSearchParams(location.search).get(NEXT_PARAM), routes.dashboard());
    return <Navigate to={next} replace />;
  }
  // "unauthenticated" and "error" both show the form; a failed network call surfaces on submit.
  return <Outlet />;
}
