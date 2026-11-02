import { TASK_STATUS_LABELS, type TaskStatus } from "@scope/contracts";

/**
 * Layout definition stored as JSON in `export_templates.definition`.
 *
 * Templates are data, not code: everything a designer may want to change about
 * the default document (page, fonts, colours, letterhead, column labels)
 * lives here, and the generator reads it. Adding a new layout means
 * adding a `layout` value and a renderer branch; checklist logic is untouched.
 *
 * Stored definitions may be partial — `parseTemplateDefinition` deep-merges
 * them over `DEFAULT_TEMPLATE_DEFINITION`, so older rows keep working when
 * new knobs are introduced.
 */
export interface ExportTemplateDefinition {
  layout: "checked-by-table";
  page: {
    size: "A4" | "Letter";
    orientation: "portrait" | "landscape";
    /** Page margins in points. */
    marginPt: number;
  };
  font: {
    family: string;
    /** Body size in points; headings and small print derive from it. */
    sizePt: number;
  };
  colors: {
    /** Hex without `#`. */
    headerFill: string;
    headerText: string;
    border: string;
    text: string;
    muted: string;
  };
  columns: {
    /** Widths in percent of the table; must add up to 100. */
    developerPct: number;
    clientPct: number;
    itemPct: number;
    remarksPct: number;
  };
  /** Centred letterhead printed above the project title. */
  header: {
    /** PNG file name inside the API's `assets/` directory (or an absolute path); empty = no logo. */
    logo: string;
    /** Rendered logo width in points; the height follows the image's aspect ratio. */
    logoWidthPt: number;
    /** Bold lines under the logo, e.g. the organisation and its accreditation. */
    organisation: string[];
    /** Document title, e.g. "Purchase Order Checklist". */
    documentTitle: string;
    /** Word between the document title and the project name, e.g. "FOR". */
    connector: string;
  };
  labels: {
    checkedBy: string;
    developer: string;
    client: string;
    itemDescription: string;
    remarks: string;
    noItems: string;
    generated: string;
    /** Progress block heading, e.g. "Progress". */
    progress: string;
    /** Printed after the percentage, e.g. "complete". */
    complete: string;
    /** "{resolved} of {total} items resolved" — the `items` word. */
    items: string;
    resolved: string;
  };
  statusLabels: Record<TaskStatus, string>;
  chart: {
    /** Whether the progress chart is offered at all; the user can still turn it off per export. */
    enabled: boolean;
    /** Rendered width of the pie in points. */
    sizePt: number;
    /** Slice colour per status (hex without `#`) — the same hues as the status dots in the web app. */
    colors: Record<TaskStatus, string>;
  };
  /** Cell fill + text colour per status for the Remarks column (hex without `#`). */
  statusColors: Record<TaskStatus, { fill: string; text: string }>;
  checkbox: {
    /** Unicode code points (hex) and font for the checked / unchecked glyphs. */
    checkedCode: string;
    uncheckedCode: string;
    font: string;
    /** Whether the logged date, time and name under a ticked box are offered at all; the user can still turn them off per export. */
    showCheckedAt: boolean;
  };
  footer: {
    pageNumbers: boolean;
    /** Repeat the "Checked by / Item Description / Remarks" header on every page. */
    repeatTableHeader: boolean;
  };
}

export const DEFAULT_TEMPLATE_DEFINITION: ExportTemplateDefinition = {
  layout: "checked-by-table",
  page: { size: "A4", orientation: "portrait", marginPt: 54 },
  font: { family: "Calibri", sizePt: 10 },
  colors: { headerFill: "8EA9DB", headerText: "1B1B1F", border: "1B1B1F", text: "1B1B1F", muted: "5F6068" },
  columns: { developerPct: 12, clientPct: 12, itemPct: 54, remarksPct: 22 },
  header: {
    logo: "infosoft-logo.png",
    logoWidthPt: 200,
    organisation: ["Software development team under Mini Clean Business Solutions", "PHILGEPS Platinum Certified"],
    documentTitle: "Purchase Order Checklist",
    connector: "FOR",
  },
  labels: {
    checkedBy: "Checked by",
    developer: "Developer",
    client: "Client",
    itemDescription: "Item Description",
    remarks: "Remarks",
    noItems: "No items.",
    generated: "Generated",
    progress: "Progress",
    complete: "complete",
    items: "items",
    resolved: "resolved",
  },
  statusLabels: { ...TASK_STATUS_LABELS },
  chart: {
    enabled: true,
    sizePt: 150,
    colors: {
      not_started: "2A4FD6",
      in_development: "E8C75A",
      for_qa: "F08C2E",
      for_revision: "6B3A1E",
      done_for_production: "2E9D4A",
      for_user_acceptance: "C9B6E4",
      done: "34A853",
      for_beta_testing: "C7C9D1",
      completed: "0F6B3F",
      on_hold: "3C3C43",
      not_applicable: "8A8A93",
    },
  },
  statusColors: {
    not_started: { fill: "E9EEFB", text: "1F3EA8" },
    in_development: { fill: "FBF3D4", text: "7A5F0B" },
    for_qa: { fill: "FDEBD9", text: "8A4A0F" },
    for_revision: { fill: "F1E4DD", text: "5A2F16" },
    done_for_production: { fill: "E3F4E7", text: "1F6F33" },
    for_user_acceptance: { fill: "F1ECF9", text: "5C4487" },
    done: { fill: "E3F4E7", text: "1F6F33" },
    for_beta_testing: { fill: "EEEFF2", text: "4F5160" },
    completed: { fill: "DCEFE5", text: "0B4F2E" },
    on_hold: { fill: "E6E6EA", text: "2A2A30" },
    not_applicable: { fill: "EDEDF0", text: "5B5B64" },
  },
  checkbox: { checkedCode: "2611", uncheckedCode: "2610", font: "MS Gothic", showCheckedAt: true },
  footer: { pageNumbers: true, repeatTableHeader: true },
};

/**
 * Merge a stored (possibly partial or legacy) definition over the defaults.
 * Unknown keys are ignored; invalid JSON yields the defaults.
 */
export function parseTemplateDefinition(stored: unknown): ExportTemplateDefinition {
  let raw: unknown = stored;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  if (!isRecord(raw)) return structuredClone(DEFAULT_TEMPLATE_DEFINITION);

  const merged = deepMerge(structuredClone(DEFAULT_TEMPLATE_DEFINITION) as unknown as Record<string, unknown>, raw) as unknown as ExportTemplateDefinition;

  // Legacy Phase 2 shape: { header: { fill } }. (`signature`, also stored by
  // older templates, is simply ignored — the document no longer has that area.)
  const header = raw.header;
  if (isRecord(header) && typeof header.fill === "string") merged.colors.headerFill = header.fill;

  merged.layout = "checked-by-table";
  for (const key of Object.keys(merged.colors) as (keyof ExportTemplateDefinition["colors"])[]) {
    merged.colors[key] = normaliseHex(merged.colors[key], DEFAULT_TEMPLATE_DEFINITION.colors[key]);
  }
  for (const key of Object.keys(merged.chart.colors) as TaskStatus[]) {
    merged.chart.colors[key] = normaliseHex(merged.chart.colors[key], DEFAULT_TEMPLATE_DEFINITION.chart.colors[key]);
  }
  if (!Number.isFinite(merged.chart.sizePt) || merged.chart.sizePt < 60 || merged.chart.sizePt > 400) merged.chart.sizePt = DEFAULT_TEMPLATE_DEFINITION.chart.sizePt;
  if (!Number.isFinite(merged.header.logoWidthPt) || merged.header.logoWidthPt < 40 || merged.header.logoWidthPt > 500) merged.header.logoWidthPt = DEFAULT_TEMPLATE_DEFINITION.header.logoWidthPt;
  // Stored definitions may hand over a single string or a list with blanks.
  const organisation: unknown = merged.header.organisation;
  merged.header.organisation = (Array.isArray(organisation) ? organisation : [organisation]).filter((line): line is string => typeof line === "string" && line.trim() !== "").map((line) => line.trim());
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) continue;
    const current = target[key];
    if (isRecord(current) && isRecord(value)) target[key] = deepMerge(current, value);
    else if (value !== undefined && value !== null && typeof value === typeof current) target[key] = value;
  }
  return target;
}

function normaliseHex(value: string, fallback: string): string {
  const hex = value.replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}
