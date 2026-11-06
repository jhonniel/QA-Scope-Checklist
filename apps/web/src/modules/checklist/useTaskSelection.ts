import { useCallback, useMemo, useState } from "react";
import type { Task } from "@scope/contracts";

export function toggleSelectedId(ids: ReadonlySet<string>, uuid: string): Set<string> {
  const next = new Set(ids);
  if (next.has(uuid)) next.delete(uuid);
  else next.add(uuid);
  return next;
}

export function nextSelectAll(ids: ReadonlySet<string>, visibleUuids: readonly string[]): Set<string> {
  const allOn = visibleUuids.length > 0 && visibleUuids.every((id) => ids.has(id));
  return allOn ? new Set() : new Set(visibleUuids);
}

/** Which tasks in the current list are checked for a bulk action. */
export function useTaskSelection(visible: Task[]) {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const selectedTasks = useMemo(() => visible.filter((t) => ids.has(t.uuid)), [visible, ids]);
  const pickedUuids = useMemo(() => new Set(selectedTasks.map((t) => t.uuid)), [selectedTasks]);
  const allSelected = visible.length > 0 && selectedTasks.length === visible.length;

  const toggle = useCallback((uuid: string) => {
    setIds((prev) => toggleSelectedId(prev, uuid));
  }, []);

  const toggleAll = useCallback(() => {
    setIds((prev) => nextSelectAll(prev, visible.map((t) => t.uuid)));
  }, [visible]);

  const clear = useCallback(() => setIds(new Set()), []);

  return { selectedTasks, pickedUuids, allSelected, toggle, toggleAll, clear };
}
