import type { ChecklistSection, Project, Task, Uuid } from "@scope/contracts";
import { statusLabel } from "./taskStatus";

/** Normalise a search string: trimmed, lower-case; empty means "no filter". */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** The one matching rule for tasks — title, description, status label or assignee name. `q` must be normalised. */
export function taskMatches(task: Task, q: string): boolean {
  if (!q) return true;
  return (
    task.title.toLowerCase().includes(q) ||
    (task.description ?? "").toLowerCase().includes(q) ||
    statusLabel(task.status).toLowerCase().includes(q) ||
    (task.assignee?.name.toLowerCase().includes(q) ?? false)
  );
}

/** Projects match on name or description. */
export function projectMatches(project: Project, q: string): boolean {
  if (!q) return true;
  return project.name.toLowerCase().includes(q) || (project.description ?? "").toLowerCase().includes(q);
}

/** Scopes and revisions match on title or description. */
export function sectionMatches(section: ChecklistSection, q: string): boolean {
  if (!q) return true;
  return section.title.toLowerCase().includes(q) || (section.description ?? "").toLowerCase().includes(q);
}

export interface TaskHit {
  task: Task;
  project: Project;
  section: ChecklistSection | undefined;
}

export interface SectionHit {
  section: ChecklistSection;
  project: Project;
}

export interface WorkspaceSearchResult {
  projects: Project[];
  sections: SectionHit[];
  tasks: TaskHit[];
  /** True when more tasks matched than were returned. */
  truncated: boolean;
}

export interface WorkspaceSearchOptions {
  maxProjects?: number;
  maxSections?: number;
  maxTasks?: number;
}

/**
 * Search everything the browser holds: project names first, then tasks across
 * every cached project (in project order, then by position). Title matches
 * rank above matches on description, status or assignee so the most likely
 * target sits at the top.
 */
export function searchWorkspace(
  query: string,
  projects: Project[],
  tasksByProject: Record<Uuid, Task[] | undefined>,
  sectionsByProject: Record<Uuid, ChecklistSection[] | undefined>,
  { maxProjects = 4, maxSections = 4, maxTasks = 8 }: WorkspaceSearchOptions = {},
): WorkspaceSearchResult {
  const q = normalizeQuery(query);
  if (!q) return { projects: [], sections: [], tasks: [], truncated: false };

  const byName = (p: Project) => (p.name.toLowerCase().includes(q) ? 0 : 1);
  const matchedProjects = projects
    .filter((p) => projectMatches(p, q))
    .sort((a, b) => byName(a) - byName(b))
    .slice(0, maxProjects);

  const sectionHits: SectionHit[] = [];
  for (const project of projects) {
    for (const section of sectionsByProject[project.uuid] ?? []) {
      if (sectionMatches(section, q)) sectionHits.push({ section, project });
    }
  }
  const bySectionTitle = (hit: SectionHit) => (hit.section.title.toLowerCase().includes(q) ? 0 : 1);
  sectionHits.sort((a, b) => bySectionTitle(a) - bySectionTitle(b));

  const hits: TaskHit[] = [];
  for (const project of projects) {
    const tasks = tasksByProject[project.uuid];
    if (!tasks) continue;
    const sections = sectionsByProject[project.uuid] ?? [];
    for (const task of tasks) {
      if (!taskMatches(task, q)) continue;
      hits.push({ task, project, section: sections.find((s) => s.uuid === task.sectionUuid) });
    }
  }
  const byTitle = (hit: TaskHit) => (hit.task.title.toLowerCase().includes(q) ? 0 : 1);
  hits.sort((a, b) => byTitle(a) - byTitle(b));

  return {
    projects: matchedProjects,
    sections: sectionHits.slice(0, maxSections),
    tasks: hits.slice(0, maxTasks),
    truncated: hits.length > maxTasks,
  };
}
