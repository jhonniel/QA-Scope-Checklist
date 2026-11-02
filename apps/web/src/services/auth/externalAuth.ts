import { useSyncExternalStore } from "react";
import { setAuthTokenProvider, usingMockApi } from "@/services/api";

/**
 * Which identity provider the web app runs against.
 *
 * `VITE_CLERK_PUBLISHABLE_KEY` turns on Clerk: sign-in/sign-up are Clerk's
 * components and API calls carry a Clerk session token. Without it, the
 * built-in e-mail + password pages and the session cookie are used. The API
 * must be configured the same way (`AUTH_PROVIDER`); both settings arrive
 * together through `clerk env pull`. Mock mode has no provider at all.
 */
export const clerkPublishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim() || null;
export const usingClerk = clerkPublishableKey !== null && !usingMockApi;

export type ExternalAuthStatus = "loading" | "signed-in" | "signed-out";

interface ExternalAuthState {
  status: ExternalAuthStatus;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/**
 * Small bridge between the lazily loaded Clerk chunk and the rest of the app
 * (route guards, the store, the HTTP client), so none of them import Clerk.
 */
let state: ExternalAuthState = { status: "loading", getToken: async () => null, signOut: async () => {} };
const listeners = new Set<() => void>();
let resolveReady: (() => void) | null = null;
const ready = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export const externalAuth = {
  get: () => state,
  set(next: ExternalAuthState) {
    state = next;
    if (next.status !== "loading") resolveReady?.();
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Resolves once the provider has decided whether someone is signed in. */
  ready: () => ready,
};

export function useExternalAuthStatus(): ExternalAuthStatus {
  return useSyncExternalStore(externalAuth.subscribe, () => state.status, () => state.status);
}

if (usingClerk) {
  // Requests wait for Clerk to load, then attach its session token; signed-out requests go without one.
  setAuthTokenProvider(async () => {
    await externalAuth.ready();
    return state.getToken();
  });
}
