import type { ScopeApi } from "@/services/api/types";

/**
 * Substituted for `mockApi.ts` by the Vite config in production builds that
 * target a real API (`VITE_API_URL` set), so sample users and fixtures are
 * never shipped to end users. The real `api` export never reaches this object.
 */
export const mockApi: ScopeApi = new Proxy({} as ScopeApi, {
  get() {
    throw new Error("The in-memory mock API is not included in this build.");
  },
});
