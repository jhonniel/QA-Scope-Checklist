import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import type { ChecklistSection, Project, Task, TaskCheck } from "@scope/contracts";
import { formatDateTime, formatLongDate, formatShortDate, formatTime } from "@/lib/date";
import { downloadBlob } from "@/lib/download";
import { BottomSheet, Button, Checkbox, Select } from "@/design-system";
import { TaskStatusBadge } from "@/modules/checklist/TaskStatusBadge";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";

/** A "Checked by" cell: ☑ with the logged date/time, or an empty ☐. */
function DocCheckCell({ check }: { check: TaskCheck | null }) {
  return (
    <td className="border border-ink/70 px-1 py-2 text-center">
      <span className="mx-auto flex size-3.5 items-center justify-center border border-ink text-[10px] leading-none" aria-hidden>
        {check ? "✓" : ""}
      </span>
      {check ? (
        <span className="mt-1 block text-[8.5px] leading-[11px] text-ink-muted" title={`Checked by ${check.checkedBy.name}, ${formatDateTime(check.checkedAt)}`}>
          <time dateTime={check.checkedAt} className="block">
            {formatShortDate(check.checkedAt)}, {formatTime(check.checkedAt)}
          </time>
          <span className="block truncate">{check.checkedBy.name}</span>
        </span>
      ) : (
        <span className="sr-only">Not checked</span>
      )}
    </td>
  );
}

export interface ExportPreviewSheetProps {
  project: Project;
  sections: ChecklistSection[];
  tasks: Task[];
  open: boolean;
  onClose: () => void;
}

/**
 * Export preview and download. Renders the default document template as HTML
 * so users can review structure and choose sections, then asks the API to
 * generate the DOCX with the same options. The preview intentionally mirrors
 * the server-side template (title, details, "Checked by" table, numbered
 * sections, checkbox rows with logged ticks, status remarks, signature area);
 * the template itself lives server-side (`export_templates`) so its layout
 * can change without touching this screen.
 */
export function ExportPreviewSheet({ project, sections, tasks, open, onClose }: ExportPreviewSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sections.map((s) => s.uuid)));
  const [includeDescriptions, setIncludeDescriptions] = useState(true);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [templateUuid, setTemplateUuid] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const templates = useAppStore((s) => s.exportTemplates);
  const loadExportTemplates = useAppStore((s) => s.loadExportTemplates);
  const exportProject = useAppStore((s) => s.exportProject);
  const { submitting, error, fieldErrors, run } = useFormSubmit();

  useEffect(() => {
    if (open) void loadExportTemplates();
  }, [open, loadExportTemplates]);

  const chosen = useMemo(() => sections.filter((s) => selected.has(s.uuid)), [sections, selected]);
  const chosenTaskCount = tasks.filter((t) => selected.has(t.sectionUuid)).length;
  const template = templates.find((t) => t.uuid === templateUuid) ?? templates.find((t) => t.isDefault) ?? templates[0] ?? null;
  const problem = error ?? fieldErrors.sectionUuids ?? fieldErrors.templateUuid ?? fieldErrors.timeZone ?? null;

  const toggleSection = (uuid: string) => {
    setDownloaded(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const download = () =>
    run(async () => {
      setDownloaded(null);
      const file = await exportProject(project.uuid, {
        // Omit the list when everything is selected so the server exports the whole project.
        sectionUuids: chosen.length === sections.length ? undefined : chosen.map((s) => s.uuid),
        includeDescriptions,
        includeSignature,
        templateUuid: template?.uuid,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      downloadBlob(file.blob, file.fileName);
      setDownloaded(`${file.fileName} · ${file.sectionCount} ${file.sectionCount === 1 ? "section" : "sections"}, ${file.taskCount} ${file.taskCount === 1 ? "task" : "tasks"}`);
    });

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Export checklist"
      description="Preview the document, then download it as DOCX."
      snapPoints={[0.94]}
      desktop="panel"
      desktopWidthClassName="max-w-4xl"
      footer={
        <div className="flex flex-col gap-2">
          {problem && <FormAlert>{problem}</FormAlert>}
          {downloaded && !problem && (
            <FormAlert tone="success">
              Downloaded <span className="font-medium">{downloaded}</span>
            </FormAlert>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              {chosen.length} of {sections.length} sections · {chosenTaskCount} tasks
            </p>
            <Button
              variant="primary"
              leadingIcon={<Download className="size-4" aria-hidden />}
              onClick={() => void download()}
              loading={submitting}
              disabled={chosen.length === 0}
              title={chosen.length === 0 ? "Select at least one section" : undefined}
            >
              Download .docx
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Options — a compact toolbar above the page so the document keeps its full width. */}
        <aside className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="min-w-0">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Sections</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {sections.map((s) => (
                <li key={s.uuid} className="flex items-center gap-2 py-1">
                  <Checkbox checked={selected.has(s.uuid)} onChange={() => toggleSection(s.uuid)} label={`Include ${s.title}`} />
                  <span className="truncate text-sm text-ink">{s.title}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Options</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              <li className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={includeDescriptions}
                  onChange={(v) => {
                    setDownloaded(null);
                    setIncludeDescriptions(v);
                  }}
                  label="Include task descriptions"
                />
                <span className="text-sm text-ink">Task descriptions</span>
              </li>
              <li className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={includeSignature}
                  onChange={(v) => {
                    setDownloaded(null);
                    setIncludeSignature(v);
                  }}
                  label="Include signature area"
                />
                <span className="text-sm text-ink">Signature area</span>
              </li>
            </ul>
          </div>
          {templates.length > 1 && (
            <div className="min-w-[12rem]">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Template</p>
              <Select aria-label="Document template" value={template?.uuid ?? ""} onChange={(e) => setTemplateUuid(e.target.value || null)}>
                {templates.map((t) => (
                  <option key={t.uuid} value={t.uuid}>
                    {t.name}
                    {t.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </aside>

        {/* Document preview */}
        {/* The page keeps its print proportions; on narrow screens it scrolls sideways inside the sheet instead of squeezing the table. */}
        <div className="overflow-x-auto rounded-xl border border-line bg-surface-muted p-3 sm:p-5">
          <article className="mx-auto min-w-[34rem] max-w-[44rem] rounded-sm bg-white px-6 py-9 text-ink shadow-float sm:px-10 sm:py-12" aria-label="Document preview">
            <header className="border-b border-ink/80 pb-4">
              <p className="text-[10px] font-medium tracking-[0.2em] text-ink-muted uppercase">Scope Checklist</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">{project.name}</h1>
              {project.description && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{project.description}</p>}
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-ink-faint">Owner</dt>
                  <dd className="font-medium">{project.owner.name}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Start</dt>
                  <dd className="font-medium">{formatLongDate(project.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Deadline</dt>
                  <dd className="font-medium">{formatLongDate(project.deadline)}</dd>
                </div>
              </dl>
            </header>

            {chosen.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-faint">Select at least one section to include.</p>
            ) : (
              <table className="mt-6 w-full table-fixed border-collapse text-[12px] leading-5" aria-label="Checklist">
                <colgroup>
                  <col className="w-[4rem]" />
                  <col className="w-[4rem]" />
                  <col />
                  <col className="w-[6.75rem]" />
                </colgroup>
                <thead>
                  <tr className="bg-[#8ea9db] text-ink">
                    <th colSpan={2} scope="colgroup" className="border border-ink/70 px-2 py-1.5 text-center font-medium">
                      Checked by
                    </th>
                    <th rowSpan={2} scope="col" className="border border-ink/70 px-3 py-1.5 text-center font-medium">
                      Item Description
                    </th>
                    <th rowSpan={2} scope="col" className="border border-ink/70 px-2 py-1.5 text-center font-medium">
                      Remarks
                    </th>
                  </tr>
                  <tr className="bg-[#8ea9db] text-ink">
                    <th scope="col" className="border border-ink/70 px-1 py-1 text-center text-[11px] font-medium">
                      Developer
                    </th>
                    <th scope="col" className="border border-ink/70 px-1 py-1 text-[11px] text-center font-medium">
                      Client
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chosen.map((section, index) => {
                    const items = tasks.filter((t) => t.sectionUuid === section.uuid).sort((a, b) => a.position - b.position);
                    return (
                      <Fragment key={section.uuid}>
                        <tr className="break-inside-avoid">
                          <td className="border border-ink/70" />
                          <td className="border border-ink/70" />
                          <td className="border border-ink/70 px-3 py-1.5 font-medium">
                            {index + 1}. {section.title}
                            {section.description && <span className="block text-[11px] font-normal text-ink-muted">{section.description}</span>}
                          </td>
                          <td className="border border-ink/70" />
                        </tr>
                        {items.map((t) => (
                          <tr key={t.uuid} className="break-inside-avoid align-top">
                            <DocCheckCell check={t.developerCheck} />
                            <DocCheckCell check={t.clientCheck} />
                            <td className="border border-ink/70 px-3 py-2">
                              <span className="flex gap-2">
                                <span aria-hidden>-</span>
                                <span className="min-w-0">
                                  {t.title}
                                  {includeDescriptions && t.description && <span className="block text-[11px] text-ink-muted">{t.description}</span>}
                                </span>
                              </span>
                            </td>
                            <td className="border border-ink/70 px-1.5 py-2">
                              <TaskStatusBadge status={t.status} wrap />
                            </td>
                          </tr>
                        ))}
                        {items.length === 0 && (
                          <tr>
                            <td className="border border-ink/70" />
                            <td className="border border-ink/70" />
                            <td className="border border-ink/70 px-3 py-1.5 text-[11px] text-ink-faint">No items.</td>
                            <td className="border border-ink/70" />
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            {includeSignature && chosen.length > 0 && (
              <footer className="mt-10 grid grid-cols-2 gap-8 pt-6 text-xs">
                <div>
                  <div className="h-8 border-b border-ink/70" />
                  <p className="mt-1.5 text-ink-muted">Prepared by</p>
                </div>
                <div>
                  <div className="h-8 border-b border-ink/70" />
                  <p className="mt-1.5 text-ink-muted">Approved by</p>
                </div>
              </footer>
            )}
          </article>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
            <FileText className="size-3.5" aria-hidden /> Preview approximates the DOCX layout · Template: {template?.name ?? "Default"}
            {template?.description ? ` — ${template.description}` : ""}
          </p>
        </div>
      </div>
    </BottomSheet>
  );
}
