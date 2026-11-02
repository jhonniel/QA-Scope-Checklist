import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSearchParams, type SetURLSearchParams } from "react-router";
import { SEARCH_PARAM } from "@/app/routes";

/**
 * The live query is kept in a module store so typing does not depend on a
 * React Router navigation completing. Writing `?q=` on every keystroke is a
 * location change: the router then focuses `<main tabIndex=-1>`, the search
 * input blurs, and the results dropdown never stays open.
 *
 * Filters read `live` immediately. The URL is updated after a short idle so
 * the address bar stays shareable without stealing focus mid-keystroke.
 */
let live = "";
const listeners = new Set<() => void>();
function emit(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getLive(): string {
  return live;
}
function setLive(next: string): void {
  if (next === live) return;
  live = next;
  emit();
}

let urlWriteTimer: ReturnType<typeof setTimeout> | null = null;
/** Non-null while a local edit has not yet been written to `?q=`. */
let pendingUrl: string | null = null;
const URL_WRITE_MS = 320;

function writeUrl(setParams: SetURLSearchParams, value: string): void {
  pendingUrl = null;
  setParams(
    (prev) => {
      const current = prev.get(SEARCH_PARAM) ?? "";
      if (current === value) return prev;
      const copy = new URLSearchParams(prev);
      if (value) copy.set(SEARCH_PARAM, value);
      else copy.delete(SEARCH_PARAM);
      return copy;
    },
    { replace: true, preventScrollReset: true },
  );
}

function scheduleUrlWrite(setParams: SetURLSearchParams, value: string): void {
  pendingUrl = value;
  if (urlWriteTimer) clearTimeout(urlWriteTimer);
  urlWriteTimer = setTimeout(() => {
    urlWriteTimer = null;
    writeUrl(setParams, value);
  }, URL_WRITE_MS);
}

/** Push the in-memory query to `?q=` now (blur / pick / test). */
export function flushSearchQuery(setParams: SetURLSearchParams): void {
  if (urlWriteTimer) {
    clearTimeout(urlWriteTimer);
    urlWriteTimer = null;
  }
  writeUrl(setParams, live);
}

/** Drop the query without writing `?q=` — used when navigating to a result. */
export function clearSearchQuery(): void {
  if (urlWriteTimer) {
    clearTimeout(urlWriteTimer);
    urlWriteTimer = null;
  }
  pendingUrl = null;
  setLive("");
}

/** Read/write the shared search term (`?q=` plus an in-memory copy that updates on the same tick). */
export function useSearchQuery(): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const urlValue = params.get(SEARCH_PARAM) ?? "";
  // First paint after a refresh / deep link: adopt the URL before effects run.
  if (live === "" && urlValue && pendingUrl === null) live = urlValue;
  const value = useSyncExternalStore(subscribe, getLive, () => urlValue);

  // Back/forward or a link that carries `?q=` — adopt the URL when it was not us who wrote it.
  useEffect(() => {
    if (pendingUrl !== null) return;
    if (urlValue !== live) setLive(urlValue);
  }, [urlValue]);

  const setValue = useCallback(
    (next: string) => {
      setLive(next);
      scheduleUrlWrite(setParams, next);
    },
    [setParams],
  );
  return [value, setValue];
}
