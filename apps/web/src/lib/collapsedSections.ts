const storageKey = (projectUuid: string) => `scope-checklist.collapsed-sections.${projectUuid}`;

/** Parse a stored JSON array of section UUIDs. Junk or missing data is treated as none collapsed. */
export function parseCollapsedList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export function serializeCollapsedList(uuids: ReadonlySet<string>): string {
  return JSON.stringify([...uuids]);
}

/** Returns a new set with `sectionUuid` flipped. */
export function nextCollapsed(collapsed: ReadonlySet<string>, sectionUuid: string): Set<string> {
  const next = new Set(collapsed);
  if (next.has(sectionUuid)) next.delete(sectionUuid);
  else next.add(sectionUuid);
  return next;
}

export function readCollapsedSections(projectUuid: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    return new Set(parseCollapsedList(localStorage.getItem(storageKey(projectUuid))));
  } catch {
    return new Set();
  }
}

export function writeCollapsedSections(projectUuid: string, uuids: ReadonlySet<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectUuid), serializeCollapsedList(uuids));
  } catch {
    // Quota or private mode — collapse still works for this visit.
  }
}
