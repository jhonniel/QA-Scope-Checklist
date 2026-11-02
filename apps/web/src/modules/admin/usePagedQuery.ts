import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Paginated } from "@scope/contracts";
import { ApiError } from "@/services/api";

/**
 * Server-paged list state for the admin pages. The `key` string encodes every
 * input of `load` (filters, page, debounced search); changing it re-fetches,
 * and late responses from a superseded request are ignored.
 */
export function usePagedQuery<T>(load: () => Promise<Paginated<T>>, key: string) {
  const [result, setResult] = useState<Paginated<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((res) => {
        if (id === requestId.current) setResult(res);
      })
      .catch((err) => {
        if (id === requestId.current) setError(ApiError.message(err));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /** Replace one item in the current page without a round-trip. */
  const replaceItem = useCallback((match: (item: T) => boolean, next: T) => {
    setResult((r) => (r ? { ...r, items: r.items.map((item) => (match(item) ? next : item)) } : r));
  }, []);

  return { result, loading, error, reload, replaceItem };
}

/** Value that lags `value` by `delay` ms — keeps server-side search from firing on every keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * `?page=` plus named filter params in the URL, so the view survives
 * navigation. Changing a filter resets to the first page.
 */
export function useListParams<F extends string>(filters: readonly F[]) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const values = Object.fromEntries(filters.map((f) => [f, params.get(f) ?? ""])) as Record<F, string>;

  const update = useCallback(
    (patch: Partial<Record<F | "page", string | number>>) => {
      const next = new URLSearchParams(params);
      let filterChanged = false;
      for (const f of filters) {
        if (patch[f] === undefined) continue;
        filterChanged = true;
        const v = String(patch[f]);
        v && v !== "all" ? next.set(f, v) : next.delete(f);
      }
      const pageValue = patch.page !== undefined ? Number(patch.page) : filterChanged ? 1 : page;
      pageValue <= 1 ? next.delete("page") : next.set("page", String(pageValue));
      setParams(next, { replace: patch.page === undefined });
    },
    [params, page, filters, setParams],
  );

  return { page, values, update };
}
