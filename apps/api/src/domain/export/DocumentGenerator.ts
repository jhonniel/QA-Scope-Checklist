import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  CheckBox,
  Document,
  Footer,
  ImageRun,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IBorderOptions,
  type TableVerticalAlign,
  type ParagraphChild,
} from "docx";
import { renderPieChartPng, statusBreakdown } from "./chart.ts";
import { groupByPhaseTitle, sectionsOfKind, type ChecklistDocument, type DocumentCheck, type DocumentItem, type DocumentSection } from "./document.ts";
import type { ExportTemplateDefinition } from "./template.ts";

/** A generated file ready to be streamed to the client. */
export interface GeneratedFile {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

/**
 * Renders a `ChecklistDocument` with a template. Implementations own all
 * formatting concerns; nothing above this layer knows about Word.
 */
export interface DocumentGenerator {
  generate(doc: ChecklistDocument, template: ExportTemplateDefinition): Promise<GeneratedFile>;
}

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const TWIPS_PER_PT = 20;

/** 91.5 → "91.5%", 100 → "100%". */
function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
/** Page sizes in twips (portrait). */
const PAGE_SIZES = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } } as const;

/**
 * Default "checked-by-table" layout: a letterhead title block, an optional
 * progress block (pie chart of the exported items by status with a legend),
 * and one table with "Checked by (Developer | Client) / Item Description /
 * Remarks" whose header repeats on every page, numbered section rows, one row
 * per task with real Word checkbox controls (plus the logged date, time and
 * name under a tick) and the status label as the remark.
 */
export interface DocxGeneratorOptions {
  /** Directory that holds letterhead images referenced by `template.header.logo` (the API's `assets/`). */
  assetsDir?: string;
  log?: (message: string, error?: unknown) => void;
}

/** A PNG ready for `ImageRun`, with its pixel size so the aspect ratio is kept. */
export interface LogoImage {
  data: Buffer;
  width: number;
  height: number;
}

export class DocxDocumentGenerator implements DocumentGenerator {
  private readonly logos = new Map<string, LogoImage | null>();

  constructor(private readonly options: DocxGeneratorOptions = {}) {}

  async generate(doc: ChecklistDocument, template: ExportTemplateDefinition): Promise<GeneratedFile> {
    const r = new Renderer(doc, template, this.logo(template.header.logo));
    const file = new Document({
      creator: doc.generatedBy.name,
      title: `${doc.title} — Scope Checklist`,
      description: doc.description ?? undefined,
      styles: {
        default: {
          document: { run: { font: template.font.family, size: r.pt(template.font.sizePt), color: template.colors.text } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: r.pageSize(),
              margin: { top: r.margin, right: r.margin, bottom: r.margin, left: r.margin },
            },
          },
          footers: template.footer.pageNumbers ? { default: r.footer() } : undefined,
          children: r.body(),
        },
      ],
    });
    const buffer = await Packer.toBuffer(file);
    return { buffer, contentType: DOCX_CONTENT_TYPE, extension: "docx" };
  }

  /**
   * Resolve and read the letterhead PNG once per file name. A missing or
   * unreadable file is logged and the document is produced without a logo
   * rather than failing the export.
   */
  private logo(name: string): LogoImage | null {
    const file = name.trim();
    if (!file) return null;
    const cached = this.logos.get(file);
    if (cached !== undefined) return cached;
    let image: LogoImage | null = null;
    try {
      const path = isAbsolute(file) ? file : join(this.options.assetsDir ?? join(process.cwd(), "assets"), file);
      const data = readFileSync(path);
      const size = pngSize(data);
      if (!size) throw new Error("not a PNG file");
      image = { data, ...size };
    } catch (error) {
      this.options.log?.(`[export] letterhead logo "${file}" could not be loaded; documents are generated without it.`, error);
    }
    this.logos.set(file, image);
    return image;
  }
}

/** Width and height from a PNG's IHDR chunk, or null when the buffer is not a PNG. */
export function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

class Renderer {
  readonly margin: number;
  private readonly contentWidth: number;
  private readonly border: IBorderOptions;
  private readonly dateFormat: Intl.DateTimeFormat;
  private readonly longDateFormat: Intl.DateTimeFormat;
  private readonly timeFormat: Intl.DateTimeFormat;

  constructor(
    private readonly doc: ChecklistDocument,
    private readonly t: ExportTemplateDefinition,
    private readonly logo: LogoImage | null = null,
  ) {
    this.margin = Math.round(t.page.marginPt * TWIPS_PER_PT);
    const size = PAGE_SIZES[t.page.size];
    const pageWidth = t.page.orientation === "landscape" ? size.height : size.width;
    this.contentWidth = pageWidth - this.margin * 2;
    this.border = { style: BorderStyle.SINGLE, size: 4, color: t.colors.border };
    const timeZone = doc.options.timeZone;
    this.dateFormat = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
    this.longDateFormat = new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric", year: "numeric" });
    this.timeFormat = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  }

  /** Points → half-points (the unit `docx` uses for run sizes). */
  pt(points: number): number {
    return Math.round(points * 2);
  }

  pageSize() {
    const size = PAGE_SIZES[this.t.page.size];
    const landscape = this.t.page.orientation === "landscape";
    return {
      width: landscape ? size.height : size.width,
      height: landscape ? size.width : size.height,
      orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
    };
  }

  // ---- building blocks ----------------------------------------------------

  private run(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean; caps?: boolean } = {}): TextRun {
    return new TextRun({
      text,
      bold: opts.bold,
      italics: opts.italics,
      size: opts.size ?? this.pt(this.t.font.sizePt),
      color: opts.color ?? this.t.colors.text,
      allCaps: opts.caps,
    });
  }

  private cell(children: Paragraph[], opts: { span?: number; rowSpan?: number; fill?: string; align?: TableVerticalAlign; widthPct?: number } = {}): TableCell {
    return new TableCell({
      children: children.length ? children : [new Paragraph({ spacing: { before: 0, after: 0 } })],
      columnSpan: opts.span,
      rowSpan: opts.rowSpan,
      verticalAlign: opts.align ?? VerticalAlignTable.TOP,
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: "auto" } : undefined,
      width: opts.widthPct !== undefined ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
    });
  }

  private para(children: ParagraphChild[], opts: { center?: boolean; keepNext?: boolean; before?: number; after?: number } = {}): Paragraph {
    return new Paragraph({
      children,
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      keepNext: opts.keepNext,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 0 },
    });
  }

  // ---- body ---------------------------------------------------------------

  /**
   * Letterhead, then the scope checklist (chart + one table per phase, each
   * opened by the phase name), then — when the export contains revision
   * sections — a "Revisions" block with one chart over every revision and one
   * table per revision, each opened by a full-width banner row ("Revision as
   * of July 17, 2026" when dated, the revision's title until then). A document
   * that holds only revisions skips the empty scope table.
   */
  body(): (Paragraph | Table)[] {
    const scope = sectionsOfKind(this.doc, "scope");
    const revisions = sectionsOfKind(this.doc, "revision");
    const { labels, font } = this.t;
    const out: (Paragraph | Table)[] = [...this.titleBlock()];
    if (scope.length > 0 || revisions.length === 0) {
      out.push(...this.progressBlock(scope, labels.progress, "progress-chart"));
      const groups = groupByPhaseTitle(scope);
      if (groups.length === 0) {
        out.push(this.checklistTable([]));
      } else {
        groups.forEach((group, index) => {
          if (index > 0) out.push(new Paragraph({ spacing: { before: 0, after: 160 } }));
          out.push(this.checklistTable(group.sections, { banner: group.phaseTitle ?? undefined, titleRow: true }));
        });
      }
    }
    if (revisions.length > 0) {
      out.push(
        new Paragraph({ children: [this.run(labels.revisions, { bold: true, size: this.pt(font.sizePt + 4) })], spacing: { before: 480, after: 160 }, keepNext: true }),
        ...this.progressBlock(revisions, labels.revisionProgress, "revision-progress-chart"),
      );
      revisions.forEach((section, index) => {
        // A paragraph between two tables keeps Word from merging them into one.
        if (index > 0) out.push(new Paragraph({ spacing: { before: 0, after: 160 } }));
        out.push(this.checklistTable([section], { banner: this.revisionBanner(section) }));
      });
    }
    return out;
  }

  /** Banner text for a revision's table: the picked date (or completion day), otherwise its title. */
  private revisionBanner(section: DocumentSection): string {
    const asOf = section.revisionDate ?? section.completedAt;
    const label = asOf ? `${this.t.labels.revisionAsOf} ${this.formatAsOf(asOf)}` : section.title;
    return section.phaseTitle ? `${section.phaseTitle} · ${label}` : label;
  }

  /** Calendar dates stay on the intended day in any export time zone. */
  private formatAsOf(value: string): string {
    const instant = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
    return this.longDateFormat.format(new Date(instant));
  }

  // ---- title block --------------------------------------------------------

  /**
   * Letterhead, all centred: logo, organisation lines (bold), the document
   * title ("Purchase Order Checklist"), the connector ("FOR") and the project
   * name. Then the project description left-aligned — the first line flush,
   * continuation lines indented, as in the scope documents it mirrors.
   */
  titleBlock(): Paragraph[] {
    const { font, header } = this.t;
    const centred = (children: ParagraphChild[], opts: { before?: number; after?: number } = {}) =>
      new Paragraph({ children, alignment: AlignmentType.CENTER, spacing: { before: opts.before ?? 0, after: opts.after ?? 0 }, keepNext: true });

    const out: Paragraph[] = [];
    if (this.logo) {
      const width = Math.round(header.logoWidthPt);
      const height = Math.round((this.logo.height / this.logo.width) * width);
      out.push(
        centred(
          [new ImageRun({ type: "png", data: this.logo.data, transformation: { width, height }, altText: { title: "Logo", description: header.organisation[0] ?? "Logo", name: "letterhead-logo" } })],
          { after: 160 },
        ),
      );
    }
    for (const line of header.organisation) out.push(centred([this.run(line, { bold: true, size: this.pt(font.sizePt - 1) })]));
    if (header.documentTitle) out.push(centred([this.run(header.documentTitle, { bold: true, size: this.pt(font.sizePt + 6) })], { before: 240, after: 60 }));
    if (header.connector) out.push(centred([this.run(header.connector, { size: this.pt(font.sizePt + 2) })], { after: 60 }));
    out.push(centred([this.run(this.doc.title, { bold: true, size: this.pt(font.sizePt + 4) })], { after: this.doc.description ? 200 : 320 }));

    if (this.doc.description) {
      const lines = this.doc.description.split(/\r?\n/).map((l) => l.trimEnd()).filter((l, i, all) => l !== "" || (i > 0 && i < all.length - 1));
      lines.forEach((line, index) => {
        out.push(
          new Paragraph({
            children: [this.run(line)],
            indent: index === 0 ? undefined : { left: 360 },
            spacing: { before: 0, after: index === lines.length - 1 ? 320 : 0 },
          }),
        );
      });
    }
    return out;
  }

  // ---- progress chart -----------------------------------------------------

  /**
   * A heading, a one-line summary, then a borderless two-cell table: the pie
   * (PNG, slices clockwise from 12 o'clock, largest first) on the left and a
   * legend on the right — colour swatch, status label, count and share — in
   * the same order as the slices. Counts the items of the given sections
   * only, so the scope and the revisions each get their own chart. Skipped
   * when turned off or when there is nothing to count.
   */
  progressBlock(sections: DocumentSection[], heading: string, imageName: string): (Paragraph | Table)[] {
    if (!this.doc.options.includeChart || !this.t.chart.enabled) return [];
    const summary = statusBreakdown({ sections });
    if (summary.total === 0) return [];

    const { labels, colors, chart, statusLabels, font } = this.t;
    const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const noBorders = { top: none, bottom: none, left: none, right: none };
    const small = this.pt(font.sizePt - 1);

    // Render at ~3 device pixels per point so the pie stays crisp when printed.
    const sizePx = Math.round(chart.sizePt * 3);
    const png = renderPieChartPng(
      summary.slices.map((s) => ({ value: s.count, color: chart.colors[s.status] ?? "808080" })),
      { size: sizePx, background: null },
    );
    const image = new ImageRun({
      type: "png",
      data: png,
      transformation: { width: Math.round(chart.sizePt), height: Math.round(chart.sizePt) },
      altText: {
        title: heading,
        description: summary.slices.map((s) => `${statusLabels[s.status] ?? s.status}: ${s.count} (${formatPercent(s.percent)})`).join("; "),
        name: imageName,
      },
    });

    const legendRows = summary.slices.map(
      (s) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              children: [new Paragraph({ spacing: { before: 0, after: 0 } })],
              shading: { type: ShadingType.CLEAR, fill: chart.colors[s.status] ?? "808080", color: "auto" },
              borders: noBorders,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              width: { size: 220, type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
            }),
            new TableCell({
              children: [this.para([this.run(statusLabels[s.status] ?? s.status, { size: small })])],
              borders: noBorders,
              margins: { top: 30, bottom: 30, left: 120, right: 80 },
              verticalAlign: VerticalAlignTable.CENTER,
            }),
            new TableCell({
              children: [new Paragraph({ children: [this.run(String(s.count), { size: small, bold: true })], alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0 } })],
              borders: noBorders,
              margins: { top: 30, bottom: 30, left: 80, right: 80 },
              verticalAlign: VerticalAlignTable.CENTER,
            }),
            new TableCell({
              children: [new Paragraph({ children: [this.run(formatPercent(s.percent), { size: small, color: colors.muted })], alignment: AlignmentType.RIGHT, spacing: { before: 0, after: 0 } })],
              borders: noBorders,
              margins: { top: 30, bottom: 30, left: 80, right: 0 },
              verticalAlign: VerticalAlignTable.CENTER,
            }),
          ],
        }),
    );

    const chartTwips = Math.round(chart.sizePt * TWIPS_PER_PT);
    const chartCellWidth = chartTwips + 240;
    const legendWidth = Math.max(2000, this.contentWidth - chartCellWidth);
    const legendInner = legendWidth - 200;
    const legend = new Table({
      width: { size: legendInner, type: WidthType.DXA },
      columnWidths: [220, legendInner - 220 - 700 - 900, 700, 900],
      borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
      rows: legendRows,
    });

    return [
      new Paragraph({ children: [this.run(heading, { bold: true, size: this.pt(font.sizePt + 1) })], spacing: { before: 0, after: 60 }, keepNext: true }),
      new Paragraph({
        children: [this.run(`${summary.percent}% ${labels.complete}`, { bold: true }), this.run(`  ·  ${summary.resolved} ${labels.resolved} of ${summary.total} ${labels.items}`, { color: colors.muted })],
        spacing: { before: 0, after: 120 },
        keepNext: true,
      }),
      new Table({
        width: { size: this.contentWidth, type: WidthType.DXA },
        columnWidths: [chartCellWidth, legendWidth],
        borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
        rows: [
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                children: [new Paragraph({ children: [image], spacing: { before: 0, after: 0 } })],
                borders: noBorders,
                margins: { top: 0, bottom: 0, left: 0, right: 240 },
                width: { size: chartCellWidth, type: WidthType.DXA },
                verticalAlign: VerticalAlignTable.CENTER,
              }),
              new TableCell({
                children: [legend],
                borders: noBorders,
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
                width: { size: legendWidth, type: WidthType.DXA },
                verticalAlign: VerticalAlignTable.CENTER,
              }),
            ],
          }),
        ],
      }),
      new Paragraph({ spacing: { before: 0, after: 240 } }),
    ];
  }

  // ---- checklist table ----------------------------------------------------

  /**
   * The "Checked by / Item Description / Remarks" table for the given sections.
   * A `banner` is a full-width first row (phase name, or a revision's date).
   * `titleRow` defaults to off when a banner is set so a revision table does
   * not also print a numbered title; phase tables pass `titleRow: true`.
   */
  checklistTable(sections: DocumentSection[], { banner, titleRow = banner === undefined }: { banner?: string; titleRow?: boolean } = {}): Table {
    const { labels, colors, columns, footer } = this.t;
    const headerFont = { bold: true, color: colors.headerText };
    const headerCell = (text: string, opts: { span?: number; rowSpan?: number; widthPct?: number; small?: boolean; large?: boolean }) =>
      this.cell([this.para([this.run(text, { ...headerFont, size: opts.small ? this.pt(this.t.font.sizePt - 1) : opts.large ? this.pt(this.t.font.sizePt + 1) : undefined })], { center: true, before: opts.large ? 60 : undefined, after: opts.large ? 60 : undefined })], {
        ...opts,
        fill: colors.headerFill,
        align: VerticalAlignTable.CENTER,
      });

    const rows: TableRow[] = [];
    if (banner !== undefined) {
      rows.push(new TableRow({ tableHeader: footer.repeatTableHeader, cantSplit: true, children: [headerCell(banner, { span: 4, widthPct: 100, large: true })] }));
    }
    rows.push(
      new TableRow({
        tableHeader: footer.repeatTableHeader,
        cantSplit: true,
        children: [
          headerCell(labels.checkedBy, { span: 2, widthPct: columns.developerPct + columns.clientPct }),
          headerCell(labels.itemDescription, { rowSpan: 2, widthPct: columns.itemPct }),
          headerCell(labels.remarks, { rowSpan: 2, widthPct: columns.remarksPct }),
        ],
      }),
      new TableRow({
        tableHeader: footer.repeatTableHeader,
        cantSplit: true,
        children: [headerCell(labels.developer, { widthPct: columns.developerPct, small: true }), headerCell(labels.client, { widthPct: columns.clientPct, small: true })],
      }),
    );

    for (const section of sections) {
      rows.push(...this.sectionRows(section, { titleRow }));
    }

    const widths = [columns.developerPct, columns.clientPct, columns.itemPct, columns.remarksPct].map((pct) => Math.round((this.contentWidth * pct) / 100));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: widths,
      rows,
      borders: {
        top: this.border,
        bottom: this.border,
        left: this.border,
        right: this.border,
        insideHorizontal: this.border,
        insideVertical: this.border,
      },
    });
  }

  /**
   * A section's rows: the numbered title row (with the description under it)
   * followed by one row per item. Without `titleRow` — when the table's banner
   * already names the section — only a description, if any, precedes the items.
   */
  private sectionRows(section: DocumentSection, { titleRow }: { titleRow: boolean }): TableRow[] {
    const { columns, colors, labels } = this.t;
    const prefix = section.kind === "revision" ? labels.revisionPrefix : "";
    const heading: Paragraph[] = [];
    if (titleRow) heading.push(this.para([this.run(`${prefix}${section.number}. ${section.title}`, { bold: true })], { keepNext: true }));
    if (section.description) heading.push(this.para([this.run(section.description, { size: this.pt(this.t.font.sizePt - 1), color: colors.muted })], { keepNext: true }));

    const rows: TableRow[] = [];
    if (heading.length > 0) {
      rows.push(
        new TableRow({
          cantSplit: true,
          keepNext: true,
          children: [
            this.cell([], { widthPct: columns.developerPct }),
            this.cell([], { widthPct: columns.clientPct }),
            this.cell(heading, { widthPct: columns.itemPct }),
            this.cell([], { widthPct: columns.remarksPct }),
          ],
        }),
      );
    }

    if (section.items.length === 0) {
      rows.push(
        new TableRow({
          cantSplit: true,
          children: [
            this.cell([], { widthPct: columns.developerPct }),
            this.cell([], { widthPct: columns.clientPct }),
            this.cell([this.para([this.run(labels.noItems, { italics: true, color: colors.muted, size: this.pt(this.t.font.sizePt - 1) })])], { widthPct: columns.itemPct }),
            this.cell([], { widthPct: columns.remarksPct }),
          ],
        }),
      );
    }
    for (const item of section.items) rows.push(this.itemRow(item));
    return rows;
  }

  private itemRow(item: DocumentItem): TableRow {
    const { columns, colors, statusColors, statusLabels } = this.t;
    const status = statusColors[item.status];
    const description: Paragraph[] = [this.para([this.run(`-  ${item.title}`)])];
    if (item.description) {
      description.push(
        new Paragraph({
          children: [this.run(item.description, { size: this.pt(this.t.font.sizePt - 1), color: colors.muted })],
          indent: { left: 200 },
          spacing: { before: 20, after: 0 },
        }),
      );
    }
    return new TableRow({
      cantSplit: true,
      children: [
        this.cell(this.checkParagraphs(item.developerCheck), { widthPct: columns.developerPct, align: VerticalAlignTable.TOP }),
        this.cell(this.checkParagraphs(item.clientCheck), { widthPct: columns.clientPct, align: VerticalAlignTable.TOP }),
        this.cell(description, { widthPct: columns.itemPct }),
        this.cell([this.para([this.run(statusLabels[item.status] ?? item.status, { size: this.pt(this.t.font.sizePt - 1), color: status?.text, bold: true })], { center: true })], {
          widthPct: columns.remarksPct,
          fill: status?.fill,
          align: VerticalAlignTable.CENTER,
        }),
      ],
    });
  }

  /**
   * A Word checkbox control, with the logged date, time and name underneath
   * when ticked — unless the export turned the details off
   * (`includeCheckDetails`) or the template never shows them.
   */
  private checkParagraphs(check: DocumentCheck | null): Paragraph[] {
    const { checkbox, colors, font } = this.t;
    const box = new CheckBox({
      checked: check !== null,
      checkedState: { value: checkbox.checkedCode, font: checkbox.font },
      uncheckedState: { value: checkbox.uncheckedCode, font: checkbox.font },
    });
    const out = [this.para([box], { center: true })];
    if (check && checkbox.showCheckedAt && this.doc.options.includeCheckDetails) {
      const when = new Date(check.checkedAt);
      const tiny = this.pt(font.sizePt - 3);
      out.push(
        this.para([this.run(`${this.dateFormat.format(when)}, ${this.timeFormat.format(when)}`, { size: tiny, color: colors.muted })], { center: true, before: 40 }),
        this.para([this.run(check.checkedBy, { size: tiny, color: colors.muted })], { center: true }),
      );
    }
    return out;
  }

  // ---- footer -------------------------------------------------------------

  footer(): Footer {
    const { labels, colors, font } = this.t;
    const size = this.pt(font.sizePt - 2);
    const generated = `${labels.generated} ${this.dateFormat.format(new Date(this.doc.generatedAt))} · ${this.doc.title}`;
    return new Footer({
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: this.contentWidth }],
          children: [
            this.run(generated, { size, color: colors.muted }),
            new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size, color: colors.muted }),
          ],
        }),
      ],
    });
  }
}
