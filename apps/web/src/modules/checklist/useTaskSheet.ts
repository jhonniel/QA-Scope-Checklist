import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { Uuid } from "@scope/contracts";
import { TASK_PARAM } from "@/app/routes";

/**
 * The task detail sheet is driven by the `?task=` search param so it is
 * deep-linkable and survives refresh. Any page can open a task.
 */
export function useTaskSheet(): { taskUuid: Uuid | null; openTask: (uuid: Uuid) => void; closeTask: () => void } {
  const [params, setParams] = useSearchParams();
  const taskUuid = params.get(TASK_PARAM);

  const openTask = useCallback(
    (uuid: Uuid) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(TASK_PARAM, uuid);
        return next;
      });
    },
    [setParams],
  );

  const closeTask = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(TASK_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  return { taskUuid, openTask, closeTask };
}
