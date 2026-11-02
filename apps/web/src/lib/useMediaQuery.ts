import { useSyncExternalStore } from "react";

function subscribe(query: string, callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/** Reactive media query hook. Safe for SSR (returns `false` on the server). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `lg` breakpoint and up — the point where the sidebar appears. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
