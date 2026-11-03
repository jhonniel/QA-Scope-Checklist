import { useCallback, useEffect, useState } from "react";
import { nextCollapsed, readCollapsedSections, writeCollapsedSections } from "./collapsedSections";

/** Per-project collapsed scopes and revisions. Survives navigation and refresh. */
export function useCollapsedSections(projectUuid: string) {
  const [collapsed, setCollapsed] = useState(() => readCollapsedSections(projectUuid));

  useEffect(() => {
    setCollapsed(readCollapsedSections(projectUuid));
  }, [projectUuid]);

  const toggle = useCallback(
    (sectionUuid: string) => {
      setCollapsed((prev) => {
        const next = nextCollapsed(prev, sectionUuid);
        writeCollapsedSections(projectUuid, next);
        return next;
      });
    },
    [projectUuid],
  );

  const isCollapsed = useCallback((sectionUuid: string) => collapsed.has(sectionUuid), [collapsed]);

  return { isCollapsed, toggle };
}
