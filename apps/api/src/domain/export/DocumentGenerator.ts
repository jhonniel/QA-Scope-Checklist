import {
  AlignmentType,
  BorderStyle,
  CheckBox,
  Document,
  Footer,
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
import type { ChecklistDocument, DocumentCheck, DocumentItem, DocumentSection } from "./document.ts";
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
/** Page sizes in twips (portrait). */
const PAGE_SIZES = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } } as const;

/**
 * Default "checked-by-table" layout: a title block, one table with
 * "Checked by (Developer | Client) / Item Description / Remarks" whose header
 * repeats on every page, numbered section rows, one row per task with real
 * Word checkbox controls (plus the logged date, time and name under a tick),
 * the status label as the remark, and an optional signature area.
 */
export class DocxDocumentGenerator implements DocumentGenerator {
  async generate(doc: ChecklistDocument, template: ExportTemplateDefinition): Promise<GeneratedFile> {
    const r = new Renderer(doc, template);
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
          children: [...r.titleBlock(), r.checklistTable(), ...r.signatureBlock()],
        },
      ],
    });
    const buffer = await Packer.toBuffer(file);
    return { buffer, contentType: DOCX_CONTENT_TYPE, extension: "docx" };
  }
}

class Renderer {
  readonly margin: number;
  private readonly contentWidth: number;
  private readonly border: IBorderOptions;
  private readonly dateFormat: Intl.DateTimeFormat;
  private readonly timeFormat: Intl.DateTimeFormat;
  private readonly longDateFormat: Intl.DateTimeFormat;

  constructor(
    private readonly doc: ChecklistDocument,
    private readonly t: ExportTemplateDefinition,
  ) {
    this.margin = Math.round(t.page.marginPt * TWIPS_PER_PT);
    const size = PAGE_SIZES[t.page.size];
    const pageWidth = t.page.orientation === "landscape" ? size.height : size.width;
    this.contentWidth = pageWidth - this.margin * 2;
    this.border = { style: BorderStyle.SINGLE, size: 4, color: t.colors.border };
    const timeZone = doc.options.timeZone;
    this.dateFormat = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" });
    this.timeFormat = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
    this.longDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
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

  // ---- title block --------------------------------------------------------

  titleBlock(): Paragraph[] {
    const { labels, colors, font } = this.t;
    const small = this.pt(font.sizePt - 1.5);
    const out: Paragraph[] = [
      new Paragraph({ children: [this.run(labels.eyebrow, { size: this.pt(font.sizePt - 2), color: colors.muted, caps: true })], spacing: { after: 80 } }),
      new Paragraph({ children: [this.run(this.doc.title, { bold: true, size: this.pt(font.sizePt + 12) })], spacing: { after: 100 } }),
    ];
    if (this.doc.description) {
      out.push(new Paragraph({ children: [this.run(this.doc.description, { color: colors.muted })], spacing: { after: 140 } }));
    }
    const detail = (label: string, value: string): TextRun[] => [this.run(`${label}  `, { size: small, color: colors.muted }), this.run(value, { size: small, bold: true }), this.run("      ", { size: small })];
    out.push(
      new Paragraph({
        children: [
          ...detail(labels.owner, this.doc.owner.name),
          ...detail(labels.start, this.formatDate(this.doc.startDate)),
          ...detail(labels.deadline, this.formatDate(this.doc.deadline)),
        ],
        spacing: { after: 240 },
        border: { bottom: { ...this.border, space: 6 } },
      }),
    );
    return out;
  }

  // ---- checklist table ----------------------------------------------------

  checklistTable(): Table {
    const { labels, colors, columns, footer } = this.t;
    const headerFont = { bold: true, color: colors.headerText };
    const headerCell = (text: string, opts: { span?: number; rowSpan?: number; widthPct?: number; small?: boolean }) =>
      this.cell([this.para([this.run(text, { ...headerFont, size: opts.small ? this.pt(this.t.font.sizePt - 1) : undefined })], { center: true })], {
        ...opts,
        fill: colors.headerFill,
        align: VerticalAlignTable.CENTER,
      });

    const rows: TableRow[] = [
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
    ];

    for (const section of this.doc.sections) rows.push(...this.sectionRows(section));

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

  private sectionRows(section: DocumentSection): TableRow[] {
    const { columns, colors, labels } = this.t;
    const heading: Paragraph[] = [this.para([this.run(`${section.number}. ${section.title}`, { bold: true })], { keepNext: true })];
    if (section.description) heading.push(this.para([this.run(section.description, { size: this.pt(this.t.font.sizePt - 1), color: colors.muted })], { keepNext: true }));

    const rows: TableRow[] = [
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
    ];

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

  /** A Word checkbox control, with the logged date, time and name underneath when ticked. */
  private checkParagraphs(check: DocumentCheck | null): Paragraph[] {
    const { checkbox, colors, font } = this.t;
    const box = new CheckBox({
      checked: check !== null,
      checkedState: { value: checkbox.checkedCode, font: checkbox.font },
      uncheckedState: { value: checkbox.uncheckedCode, font: checkbox.font },
    });
    const out = [this.para([box], { center: true })];
    if (check && checkbox.showCheckedAt) {
      const when = new Date(check.checkedAt);
      const tiny = this.pt(font.sizePt - 3);
      out.push(
        this.para([this.run(`${this.dateFormat.format(when)}, ${this.timeFormat.format(when)}`, { size: tiny, color: colors.muted })], { center: true, before: 40 }),
        this.para([this.run(check.checkedBy, { size: tiny, color: colors.muted })], { center: true }),
      );
    }
    return out;
  }

  // ---- signature & footer -------------------------------------------------

  signatureBlock(): (Paragraph | Table)[] {
    if (!this.doc.options.includeSignature || !this.t.signature.enabled || this.doc.sections.length === 0) return [];
    const { labels, colors } = this.t;
    const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const line = (label: string) =>
      new TableCell({
        children: [
          new Paragraph({ spacing: { before: 560, after: 0 } }),
          new Paragraph({
            children: [this.run(label, { size: this.pt(this.t.font.sizePt - 1), color: colors.muted })],
            border: { top: { ...this.border, space: 4 } },
            spacing: { before: 0, after: 0 },
          }),
        ],
        borders: { top: none, bottom: none, left: none, right: none },
        margins: { top: 0, bottom: 0, left: 0, right: 600 },
        width: { size: 50, type: WidthType.PERCENTAGE },
      });
    return [
      new Paragraph({ spacing: { before: 360, after: 0 } }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [Math.round(this.contentWidth / 2), Math.round(this.contentWidth / 2)],
        borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
        rows: [new TableRow({ cantSplit: true, children: [line(labels.preparedBy), line(labels.approvedBy)] })],
      }),
    ];
  }

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

  // ---- formatting ---------------------------------------------------------

  /** ISO date (YYYY-MM-DD) → "November 2, 2026"; null → em dash. */
  private formatDate(value: string | null): string {
    if (!value) return "—";
    const [y, m, d] = value.split("-").map(Number);
    return this.longDateFormat.format(new Date(Date.UTC(y, m - 1, d)));
  }
}
