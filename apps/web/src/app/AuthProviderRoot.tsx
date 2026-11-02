import { lazy, Suspense, type ReactNode } from "react";
import { usingClerk } from "@/services/auth/externalAuth";

const ClerkRoot = lazy(() => import("@/app/clerk").then((m) => ({ default: m.ClerkRoot })));

/**
 * Wraps the router in the identity provider's context when one is configured.
 * With the built-in session auth this is a pass-through and the Clerk chunk is
 * never requested.
 */
export function AuthProviderRoot({ children }: { children: ReactNode }) {
  if (!usingClerk) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <ClerkRoot>{children}</ClerkRoot>
    </Suspense>
  );
}

export const ClerkSignInPage = lazy(() => import("@/app/clerk").then((m) => ({ default: m.ClerkSignInPage })));
export const ClerkSignUpPage = lazy(() => import("@/app/clerk").then((m) => ({ default: m.ClerkSignUpPage })));
export const ClerkUserMenu = lazy(() => import("@/app/clerk").then((m) => ({ default: m.ClerkUserMenu })));
export const ClerkManageAccountButton = lazy(() => import("@/app/clerk").then((m) => ({ default: m.ClerkManageAccountButton })));
