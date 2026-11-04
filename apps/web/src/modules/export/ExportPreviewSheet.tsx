import { Fragment, useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { groupSectionsByPhase, revisionAsOf, type ChecklistSection, type Phase, type Project, type Task, type TaskCheck } from "@scope/contracts";
import { formatDateTime, formatShortDate, formatTime } from "@/lib/date";
import { downloadBlob } from "@/lib/download";
import { BottomSheet, Button, Checkbox, Select } from "@/design-system";
import { RevisionBadge, revisionLabel } from "@/modules/checklist/RevisionBadge";
import { TaskStatusBadge } from "@/modules/checklist/TaskStatusBadge";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { selectPhasesOrEmpty, useAppStore } from "@/store/useAppStore";
import { ProgressChartPreview } from "./ProgressChartPreview";

/** A "Checked by" cell: ☑ (optionally with the logged date/time and name), or an empty ☐. */
function DocCheckCell({ check, showDetails }: { check: TaskCheck | null; showDetails: boolean }) {
  return (
    <td className="border border-ink/70 px-1 py-2 text-center">
      <span className="mx-auto flex size-3.5 items-center justify-center border border-ink text-[10px] leading-none" aria-hidden>
        {check ? "✓" : ""}
      </span>
      {!check && <span className="sr-only">Not checked</span>}
      {check && !showDetails && <span className="sr-only">Checked by {check.checkedBy.name}</span>}
      {check && showDetails && (
        <span className="mt-1 block text-[8.5px] leading-[11px] text-ink-muted" title={`Checked by ${check.checkedBy.name}, ${formatDateTime(check.checkedAt)}`}>
          <time dateTime={check.checkedAt} className="block">
            {formatShortDate(check.checkedAt)}, {formatTime(check.checkedAt)}
          </time>
          <span className="block truncate">{check.checkedBy.name}</span>
        </span>
      )}
    </td>
  );
}

/** Consecutive scopes that share a phase — one preview table each, phase name first. */
function groupByPhaseName(sections: ChecklistSection[], phases: Phase[]): { phase: string | null; sections: ChecklistSection[] }[] {
  const titleOf = (section: ChecklistSection) => (section.phaseUuid ? (phases.find((p) => p.uuid === section.phaseUuid)?.title ?? null) : null);
  const groups: { phase: string | null; sections: ChecklistSection[] }[] = [];
  for (const section of sections) {
    const phase = titleOf(section);
    const last = groups[groups.length - 1];
    if (last && last.phase === phase) last.sections.push(section);
    else groups.push({ phase, sections: [section] });
  }
  return groups;
}

interface DocTableProps {
  sections: ChecklistSection[];
  tasks: Task[];
  /** A full-width first row: phase name, or a revision's date. */
  banner?: string;
  /** Keep numbered scope titles under a phase banner. Revisions omit this. */
  showSectionTitles?: boolean;
  sectionNumber?: (section: ChecklistSection, index: number) => number;
  includeDescriptions: boolean;
  includeCheckDetails: boolean;
  ariaLabel: string;
}

/** The "Checked by / Item Description / Remarks" table for a group of sections — one phase, or a single revision under its banner. */
function DocTable({ sections, tasks, banner, includeDescriptions, includeCheckDetails, ariaLabel, showSectionTitles, sectionNumber }: DocTableProps) {
  const titleRow = showSectionTitles ?? banner === undefined;
  return (
    <table className="mt-6 w-full table-fixed border-collapse text-[12px] leading-5" aria-label={ariaLabel}>
      <colgroup>
        <col className="w-[4rem]" />
        <col className="w-[4rem]" />
        <col />
        <col className="w-[6.75rem]" />
      </colgroup>
      <thead>
        {banner !== undefined && (
          <tr className="bg-[#8ea9db] text-ink">
            <th colSpan={4} scope="colgroup" className="border border-ink/70 px-3 py-2 text-center text-[13px] font-medium">
              {banner}
            </th>
          </tr>
        )}
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
        {sections.map((section, index) => {
          const items = tasks.filter((t) => t.sectionUuid === section.uuid).sort((a, b) => a.position - b.position);
          const number = sectionNumber?.(section, index) ?? index + 1;
          return (
            <Fragment key={section.uuid}>
              {(titleRow || section.description) && (
                <tr className="break-inside-avoid">
                  <td className="border border-ink/70" />
                  <td className="border border-ink/70" />
                  <td className="border border-ink/70 px-3 py-1.5 font-medium">
                    {titleRow && (
                      <>
                        {section.kind === "revision" ? "R" : ""}
                        {number}. {section.title}
                      </>
                    )}
                    {section.description && <span className="block text-[11px] font-normal text-ink-muted">{section.description}</span>}
                  </td>
                  <td className="border border-ink/70" />
                </tr>
              )}
              {items.map((t) => (
                <tr key={t.uuid} className="break-inside-avoid align-top">
                  <DocCheckCell check={t.developerCheck} showDetails={includeCheckDetails} />
                  <DocCheckCell check={t.clientCheck} showDetails={includeCheckDetails} />
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
 * the server-side template (letterhead, progress chart, "Checked by" table,
 * numbered sections, checkbox rows with logged ticks, status remarks);
 * the template itself lives server-side (`export_templates`) so its layout
 * can change without touching this screen.
 */
export function ExportPreviewSheet({ project, sections, tasks, open, onClose }: ExportPreviewSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sections.map((s) => s.uuid)));
  const [includeDescriptions, setIncludeDescriptions] = useState(true);
  const [includeCheckDetails, setIncludeCheckDetails] = useState(true);
  const [includeChart, setIncludeChart] = useState(true);
  const [templateUuid, setTemplateUuid] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  const templates = useAppStore((s) => s.exportTemplates);
  const loadExportTemplates = useAppStore((s) => s.loadExportTemplates);
  const exportProject = useAppStore((s) => s.exportProject);
  const phases = useAppStore(selectPhasesOrEmpty(project.uuid));
  const { submitting, error, fieldErrors, run } = useFormSubmit();

  useEffect(() => {
    if (open) void loadExportTemplates();
  }, [open, loadExportTemplates]);

  const chosen = useMemo(() => groupSectionsByPhase(sections.filter((s) => selected.has(s.uuid)), phases).flatMap((group) => group.sections), [sections, selected, phases]);
  const chosenTasks = useMemo(() => tasks.filter((t) => selected.has(t.sectionUuid)), [tasks, selected]);
  const chosenTaskCount = chosenTasks.length;
  const pickerGroups = useMemo(() => groupSectionsByPhase(sections, phases), [sections, phases]);
  // The document prints the agreed scope first and revisions in their own block, each with its own chart.
  const scope = useMemo(() => chosen.filter((s) => s.kind !== "revision"), [chosen]);
  const revisions = useMemo(() => chosen.filter((s) => s.kind === "revision"), [chosen]);
  const tasksIn = (list: ChecklistSection[]) => {
    const uuids = new Set(list.map((s) => s.uuid));
    return chosenTasks.filter((t) => uuids.has(t.sectionUuid));
  };
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
        includeCheckDetails,
        includeChart,
        templateUuid: template?.uuid,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      downloadBlob(file.blob, file.fileName);
      setDownloaded(`${file.fileName} · ${file.sectionCount} ${file.sectionCount === 1 ? "scope" : "scopes"}, ${file.taskCount} ${file.taskCount === 1 ? "task" : "tasks"}`);
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
              {chosen.length} of {sections.length} selected · {chosenTaskCount} tasks
            </p>
            <Button
              variant="primary"
              leadingIcon={<Download className="size-4" aria-hidden />}
              onClick={() => void download()}
              loading={submitting}
              disabled={chosen.length === 0}
              title={chosen.length === 0 ? "Select at least one scope or revision" : undefined}
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
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Scopes and revisions</p>
            <ul className="flex flex-col gap-2">
              {pickerGroups.map((group) => (
                <li key={group.phase?.uuid ?? "ungrouped"}>
                  {group.phase && <p className="mb-0.5 text-[11px] font-medium text-ink-muted">{group.phase.title}</p>}
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {group.sections.map((s) => (
                      <li key={s.uuid} className="flex items-center gap-2 py-1">
                        <Checkbox checked={selected.has(s.uuid)} onChange={() => toggleSection(s.uuid)} label={`Include ${s.title}`} />
                        <span className="truncate text-sm text-ink">{s.title}</span>
                        <RevisionBadge section={s} className="text-[10px] leading-4" />
                      </li>
                    ))}
                  </ul>
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
                  checked={includeCheckDetails}
                  onChange={(v) => {
                    setDownloaded(null);
                    setIncludeCheckDetails(v);
                  }}
                  label="Include name and date under ticked boxes"
                />
                <span className="text-sm text-ink">Name and date on ticks</span>
              </li>
              <li className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={includeChart}
                  onChange={(v) => {
                    setDownloaded(null);
                    setIncludeChart(v);
                  }}
                  label="Include progress chart"
                />
                <span className="text-sm text-ink">Progress chart</span>
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
            <header className="pb-2">
              {/* Letterhead — mirrors the DOCX template's `header` block (logo, organisation lines, document title). */}
              <div className="text-center">
                <img src="/infosoft-logo.png" alt="Infosoft" width={371} height={98} className="mx-auto h-auto w-44" />
                <p className="mt-2 text-[11px] font-semibold leading-snug">
                  <span className="block">Software development team under Mini Clean Business Solutions</span>
                  <span className="block">PHILGEPS Platinum Certified</span>
                </p>
                <h1 className="mt-4 text-xl font-bold tracking-tight">Purchase Order Checklist</h1>
                <p className="mt-1 text-sm">FOR</p>
                <h2 className="mt-1 text-lg font-bold tracking-tight">{project.name}</h2>
              </div>
              {project.description && <p className="mt-3 text-sm leading-relaxed">{project.description}</p>}
            </header>

            {chosen.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-faint">Select at least one scope or revision to include.</p>
            ) : (
              <>
                {(scope.length > 0 || revisions.length === 0) && (
                  <>
                    {includeChart && <ProgressChartPreview tasks={tasksIn(scope)} />}
                    {groupByPhaseName(scope, phases).map((group, index) => (
                      <DocTable
                        key={group.phase ?? `ungrouped-${index}`}
                        sections={group.sections}
                        tasks={tasks}
                        banner={group.phase ?? undefined}
                        showSectionTitles
                        sectionNumber={(section) => scope.findIndex((s) => s.uuid === section.uuid) + 1}
                        includeDescriptions={includeDescriptions}
                        includeCheckDetails={includeCheckDetails}
                        ariaLabel={group.phase ? `Checklist · ${group.phase}` : "Checklist"}
                      />
                    ))}
                  </>
                )}
                {revisions.length > 0 && (
                  <section aria-label="Revisions" className="mt-10">
                    <h2 className="text-lg font-bold tracking-tight">Revisions</h2>
                    {includeChart && <ProgressChartPreview tasks={tasksIn(revisions)} title="Revision progress" />}
                    {revisions.map((revision) => {
                      const phase = revision.phaseUuid ? phases.find((p) => p.uuid === revision.phaseUuid)?.title : null;
                      const label = revisionAsOf(revision) ? revisionLabel(revision)! : revision.title;
                      return (
                        <DocTable
                          key={revision.uuid}
                          sections={[revision]}
                          tasks={tasks}
                          banner={phase ? `${phase} · ${label}` : label}
                          includeDescriptions={includeDescriptions}
                          includeCheckDetails={includeCheckDetails}
                          ariaLabel={`Revision: ${revision.title}`}
                        />
                      );
                    })}
                  </section>
                )}
              </>
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
