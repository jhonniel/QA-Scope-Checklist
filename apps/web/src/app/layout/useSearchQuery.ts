import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { SEARCH_PARAM } from "@/app/routes";

/** Read/write the shared `?q=` search param used by list pages. */
export function useSearchQuery(): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(SEARCH_PARAM) ?? "";
  const setValue = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next) copy.set(SEARCH_PARAM, next);
          else copy.delete(SEARCH_PARAM);
          return copy;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [value, setValue];
}
