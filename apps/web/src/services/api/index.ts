import type { ScopeApi } from "./types";
import { createHttpApi } from "./httpApi";
import { mockApi } from "@/services/mock/mockApi";

export type { ScopeApi, ExportedFile } from "./types";
export { ApiError } from "./ApiError";
export { onUnauthorized, setAuthTokenProvider } from "./httpApi";

/**
 * Single entry point for data access. Components and the store import `api`
 * from here only.
 *
 * `VITE_API_URL` selects the REST backend (e.g. `/api` through the Vite proxy
 * in development, or an absolute URL in production). When it is unset the
 * in-memory mock is used, which keeps the UI runnable without a server.
 */
const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

export const usingMockApi = !apiUrl;
export const api: ScopeApi = apiUrl ? createHttpApi(apiUrl) : mockApi;
