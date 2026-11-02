import { useEffect, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, UserButton, useAuth, useClerk } from "@clerk/react";
import { CheckSquare, UserRound } from "lucide-react";
import { router } from "@/app/router";
import { routes } from "@/app/routes";
import { Button } from "@/design-system";
import { clerkPublishableKey, externalAuth } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";

/**
 * Everything that imports `@clerk/react` lives in this module, which is
 * loaded on demand only when `VITE_CLERK_PUBLISHABLE_KEY` is set. Deployments
 * on the built-in session auth never download it.
 */

// Clerk components pick up the design tokens so they look native to the app.
const appearance = {
  variables: {
    colorPrimary: "#4f46e5",
    colorText: "#111113",
    colorBackground: "#ffffff",
    borderRadius: "0.75rem",
    fontFamily: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    card: "shadow-[0_1px_2px_rgb(16_24_40/0.04),0_8px_24px_-12px_rgb(16_24_40/0.12)] border border-line",
    footer: "hidden",
  },
};

/** Keeps the external-auth bridge and the app store in step with Clerk's client state. */
function ClerkBridge() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();

  useEffect(() => {
    externalAuth.set({
      status: !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out",
      getToken: () => getToken(),
      signOut: () => signOut(),
    });
  }, [isLoaded, isSignedIn, getToken, signOut]);

  useEffect(() => {
    // Signed out at Clerk (another tab, the user button): drop the local session state so the guards redirect.
    const store = useAppStore.getState();
    if (isLoaded && !isSignedIn && store.bootState === "ready") store.resetSession();
  }, [isLoaded, isSignedIn]);

  return null;
}

export function ClerkRoot({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey!}
      routerPush={(to) => void router.navigate(to)}
      routerReplace={(to) => void router.navigate(to, { replace: true })}
      signInUrl={routes.login()}
      signUpUrl={routes.register()}
      afterSignOutUrl={routes.login()}
      appearance={appearance}
    >
      <ClerkBridge />
      {children}
    </ClerkProvider>
  );
}

/** Centred frame with the product mark, shared by the hosted sign-in and sign-up screens. */
function ClerkAuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="mb-6 flex items-center justify-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-fg" aria-hidden>
          <CheckSquare className="size-5" strokeWidth={2.5} />
        </span>
        <span className="text-lg font-semibold tracking-tight text-ink">Scope Checklist</span>
      </div>
      {children}
    </div>
  );
}

export function ClerkSignInPage({ next }: { next: string }) {
  useEffect(() => {
    document.title = "Sign in · Scope Checklist";
  }, []);
  return (
    <ClerkAuthFrame>
      <SignIn routing="path" path={routes.login()} signUpUrl={routes.register()} forceRedirectUrl={next} />
    </ClerkAuthFrame>
  );
}

export function ClerkSignUpPage() {
  useEffect(() => {
    document.title = "Create account · Scope Checklist";
  }, []);
  return (
    <ClerkAuthFrame>
      <SignUp routing="path" path={routes.register()} signInUrl={routes.login()} forceRedirectUrl={routes.dashboard()} />
    </ClerkAuthFrame>
  );
}

/** Account menu for the top bar: Clerk's avatar button with a link back to the in-app profile. */
export function ClerkUserMenu() {
  return (
    <UserButton appearance={{ elements: { avatarBox: "size-9" } }}>
      <UserButton.MenuItems>
        <UserButton.Link label="Profile" href={routes.profile()} labelIcon={<UserRound className="size-4" aria-hidden />} />
      </UserButton.MenuItems>
    </UserButton>
  );
}

/** Opens Clerk's account modal (password, e-mail addresses, connected accounts, sessions) from the profile page. */
export function ClerkManageAccountButton({ disabled, className }: { disabled?: boolean; className?: string }) {
  const clerk = useClerk();
  return (
    <Button variant="ghost" onClick={() => clerk.openUserProfile()} disabled={disabled} className={className}>
      Manage account &amp; password
    </Button>
  );
}
