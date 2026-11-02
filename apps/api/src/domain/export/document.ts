import type { ChecklistSection, Project, Task, TaskStatus, UserSummary } from "@scope/contracts";

/**
 * The document model handed to a `DocumentGenerator`.
 *
 * It is deliberately independent of HTTP, the database and the template:
 * `ExportService` builds it from the public contracts (project, sections,
 * tasks) plus the user's options, and every renderer (DOCX today, PDF or HTML
 * later) consumes the same shape. Order is significant — sections and items
 * appear exactly in the order of the arrays.
 */
export interface ChecklistDocument {
  title: string;
  description: string | null;
  owner: UserSummary;
  startDate: string | null;
  deadline: string | null;
  status: Project["status"];
  sections: DocumentSection[];
  options: DocumentOptions;
  /** Who generated the document and when (ISO-8601). */
  generatedBy: UserSummary;
  generatedAt: string;
}

export interface DocumentSection {
  /** 1-based number as printed in the heading. */
  number: number;
  title: string;
  description: string | null;
  items: DocumentItem[];
}

export interface DocumentItem {
  title: string;
  description: string | null;
  status: TaskStatus;
  developerCheck: DocumentCheck | null;
  clientCheck: DocumentCheck | null;
}

export interface DocumentCheck {
  checkedBy: string;
  /** ISO-8601 instant; the renderer formats it in `options.timeZone`. */
  checkedAt: string;
}

export interface DocumentOptions {
  includeDescriptions: boolean;
  includeSignature: boolean;
  /** IANA time zone used to print timestamps. */
  timeZone: string;
}

export interface BuildDocumentInput {
  project: Project;
  /** Sections to include, already filtered and in project order. */
  sections: ChecklistSection[];
  /** Every task of the project; grouped by section here. */
  tasks: Task[];
  options: DocumentOptions;
  generatedBy: UserSummary;
  generatedAt?: Date;
}

/** Group tasks under their sections, preserving the stored positions. */
export function buildChecklistDocument({ project, sections, tasks, options, generatedBy, generatedAt = new Date() }: BuildDocumentInput): ChecklistDocument {
  const bySection = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = bySection.get(task.sectionUuid) ?? [];
    list.push(task);
    bySection.set(task.sectionUuid, list);
  }

  return {
    title: project.name,
    description: project.description.trim() || null,
    owner: project.owner,
    startDate: project.startDate,
    deadline: project.deadline,
    status: project.status,
    sections: sections.map((section, index) => ({
      number: index + 1,
      title: section.title,
      description: section.description?.trim() || null,
      items: (bySection.get(section.uuid) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((task) => ({
          title: task.title,
          description: options.includeDescriptions ? task.description?.trim() || null : null,
          status: task.status,
          developerCheck: toDocumentCheck(task.developerCheck),
          clientCheck: toDocumentCheck(task.clientCheck),
        })),
    })),
    options,
    generatedBy,
    generatedAt: generatedAt.toISOString(),
  };
}

function toDocumentCheck(check: Task["developerCheck"]): DocumentCheck | null {
  return check ? { checkedBy: check.checkedBy.name, checkedAt: check.checkedAt } : null;
}

export function countItems(doc: ChecklistDocument): number {
  return doc.sections.reduce((sum, s) => sum + s.items.length, 0);
}

/** File-system and header safe file name: `barangay-records-portal-scope-checklist-2026-11-02.docx`. */
export function documentFileName(doc: ChecklistDocument, extension: string): string {
  const slug =
    doc.title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project";
  return `${slug}-scope-checklist-${doc.generatedAt.slice(0, 10)}.${extension}`;
}
