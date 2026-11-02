import type { CreateExportInput, ExportTemplate, UserSummary } from "@scope/contracts";
import type { Database } from "../../db/database.ts";
import { DomainError, ValidationError } from "../errors.ts";
import { buildChecklistDocument, countItems, documentFileName } from "../export/document.ts";
import type { DocumentGenerator, GeneratedFile } from "../export/DocumentGenerator.ts";
import { parseTemplateDefinition } from "../export/template.ts";
import { toExportTemplate, toSection, toTask, type Actor } from "../models.ts";
import { repositories } from "../repositories/index.ts";
import type { ProjectService } from "./ProjectService.ts";

export interface ExportServiceOptions {
  /** IANA zone used when the client does not send one. */
  defaultTimeZone: string;
}

export interface ExportResult {
  file: GeneratedFile;
  fileName: string;
  template: ExportTemplate;
  sectionCount: number;
  taskCount: number;
}

/**
 * Orchestrates one export: authorizes, loads the checklist, resolves the
 * template, hands a `ChecklistDocument` to the generator and records the
 * export in the activity log. Rendering details live in `domain/export`.
 */
export class ExportService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
    private readonly generator: DocumentGenerator,
    private readonly options: ExportServiceOptions,
  ) {}

  async listTemplates(): Promise<ExportTemplate[]> {
    return (await repositories(this.db).exportTemplates.listAll()).map(toExportTemplate);
  }

  /** Any member (viewers included) may export — it is a read of the checklist. */
  async export(actor: Actor, generatedBy: UserSummary, projectUuid: string, input: CreateExportInput): Promise<ExportResult> {
    const { project: row } = await this.projects.requireViewable(actor, projectUuid);
    const repos = repositories(this.db);

    const templateRow = input.templateUuid ? await repos.exportTemplates.findByUuid(input.templateUuid) : await repos.exportTemplates.findDefault();
    if (!templateRow) {
      if (input.templateUuid) throw new ValidationError([{ field: "templateUuid", message: "That document template does not exist." }]);
      throw new DomainError(503, "export_unavailable", "No document template is configured. Please contact an administrator.");
    }

    const [project, allSections, tasks] = await Promise.all([
      this.projects.hydrate([row]).then((list) => list[0]),
      repos.sections.listByProject(row.id).then((rows) => rows.map(toSection)),
      repos.tasks.listByProject(row.id).then((rows) => rows.map(toTask)),
    ]);

    let sections = allSections;
    if (input.sectionUuids) {
      const wanted = new Set(input.sectionUuids);
      const known = new Set(allSections.map((s) => s.uuid));
      for (const uuid of wanted) {
        if (!known.has(uuid)) throw new ValidationError([{ field: "sectionUuids", message: "One of the selected sections no longer exists. Refresh and try again." }]);
      }
      sections = allSections.filter((s) => wanted.has(s.uuid));
    }
    if (sections.length === 0) throw new ValidationError([{ field: "sectionUuids", message: "Select at least one section to include." }]);

    const timeZone = resolveTimeZone(input.timeZone, this.options.defaultTimeZone);
    const doc = buildChecklistDocument({
      project,
      sections,
      tasks,
      options: {
        includeDescriptions: input.includeDescriptions ?? true,
        includeSignature: input.includeSignature ?? true,
        timeZone,
      },
      generatedBy,
    });

    const template = toExportTemplate(templateRow);
    const file = await this.generator.generate(doc, parseTemplateDefinition(templateRow.definition));
    const fileName = documentFileName(doc, file.extension);
    const taskCount = countItems(doc);

    await repos.activity.record({
      projectId: row.id,
      actorId: actor.id,
      action: "export.generated",
      subject: fileName,
      meta: { template: template.name, sections: sections.length, tasks: taskCount, partial: sections.length !== allSections.length },
    });

    return { file, fileName, template, sectionCount: sections.length, taskCount };
  }
}

/** Accepts any zone ICU knows; anything else is a 422 on `timeZone`. */
function resolveTimeZone(requested: string | undefined, fallback: string): string {
  if (!requested) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: requested });
    return requested;
  } catch {
    throw new ValidationError([{ field: "timeZone", message: "Unknown time zone." }]);
  }
}
