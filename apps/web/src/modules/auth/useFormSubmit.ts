import { useCallback, useState } from "react";
import { ApiError } from "@/services/api";

/**
 * Submission state for small forms: one in-flight flag, a general error and
 * per-field errors derived from the API's validation response. Prevents
 * duplicate submissions and keeps the entered values on failure.
 */
export function useFormSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (submitting) return false;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
      return true;
    } catch (err) {
      if (ApiError.is(err) && err.fields.length > 0) {
        const map = err.fieldMap;
        setFieldErrors(map);
        if (map._) setError(map._);
      } else {
        setError(ApiError.message(err));
      }
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [submitting]);

  const clearField = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  return { submitting, error, fieldErrors, run, clearField, setError };
}
