import type { Doc, Block } from "@runlog/rules-schema";
import type { Column, Content, ContentCanvas, ContentStack, ContentText, TDocumentDefinitions, TableCell, TFontDictionary } from "pdfmake/interfaces";

/**
 * A document as a PDF, from the same blocks the HTML and Markdown come from.
 *
 * The documents are not free HTML; they are eight kinds of block, so a PDF
 * is a third writer over the model rather than a conversion of the page.
 * pdfmake lays it out in the browser: no server sees the pack, it works on
 * a disk copy and offline, and the library only loads when a PDF is asked
 * for. The look follows the HTML's stylesheet: Literata throughout, muted
 * grays for the byline and the notes, hairlines under table rows, the
 * reference card small and in two columns, the run log sheet a form.
 *
 * The one thing the browser does better is flowing text through columns;
 * here the card's sections are dealt into two columns by their weight
 * instead, which reads the same and never leaves a heading orphaned.
 */

/** Everything a renderer needs to hand over, so the app and a test can bring their own. */
export interface PdfEngine {
  setFonts(fonts: TFontDictionary): void;
  createPdf(definition: TDocumentDefinitions): { getBuffer(): Promise<Uint8Array> };
}

const INK = "#161513";
const MUTED = "#5b5751";
const NOTE = "#3f3b36";
const HAIR = "#d9d4cb";
const HAIR_LIGHT = "#e4dfd6";
const NOTE_BAR = "#b9b2a5";

/** US Letter, in points, and each layout's margins from the print stylesheet. */
const PAGE = { width: 612, height: 792 };
const MARGIN = { book: 45, card: 28, sheet: 36 } as const;

export function toPdfDefinition(doc: Doc): TDocumentDefinitions {
  const margin = MARGIN[doc.layout];
  const width = PAGE.width - margin * 2;
  const base = doc.layout === "card" ? 8.5 : doc.layout === "sheet" ? 10 : 11;
  const ctx: Ctx = { base, width: doc.layout === "card" ? (width - 24) / 2 : width, layout: doc.layout };

  const head: Content[] = [{ text: glyphs(doc.title), fontSize: doc.layout === "card" ? 18 : 24, bold: true, lineHeight: 1.05, margin: [0, 0, 0, 3] }];
  if (doc.subtitle) head.push({ text: glyphs(doc.subtitle), italics: true, color: MUTED, margin: [0, 0, 0, doc.layout === "card" ? 10 : 22] });

  const body = doc.layout === "card" ? dealIntoColumns(doc.blocks, ctx) : doc.blocks.map((b, i) => block(b, ctx, doc.blocks[i - 1]));

  return {
    pageSize: "LETTER",
    pageMargins: [margin, margin, margin, margin + 10],
    info: { title: doc.subtitle ? `${doc.title} - ${doc.subtitle}` : doc.title, creator: "Runlog" },
    defaultStyle: { font: "Literata", fontSize: base, lineHeight: 1.3, color: INK },
    footer: (page, pages) => ({
      columns: [
        { text: doc.title, fontSize: 8, color: MUTED },
        { text: `${page} of ${pages}`, fontSize: 8, color: MUTED, alignment: "right" },
      ],
      margin: [margin, 0, margin, 0],
    }),
    content: [...head, ...body],
    // A heading at the foot of a page moves to the next one with its text.
    pageBreakBefore: (node, queries) => Boolean(node.headlineLevel) && queries.getFollowingNodesOnPage().length === 0,
  };
}

/**
 * The text as the embedded font can set it. Literata's Latin subset has the
 * dashes and quotes but not the checkbox and the arrow the documents use;
 * the checkbox is drawn (see `lines`), the arrow becomes a guillemet.
 */
function glyphs(text: string): string {
  return text.replace(/→/g, "›").replace(/←/g, "‹").replace(/✓/g, "√");
}

/** A paragraph's lines, each a checklist row with a drawn box where it starts with one. */
function lines(text: string, s: number, extra: Partial<ContentText> = {}): ContentText | ContentStack {
  const parts = text.split("\n");
  if (!parts.some((l) => l.startsWith("☐"))) return { text: glyphs(text), ...extra };
  return {
    stack: parts.map((l): Content =>
      l.startsWith("☐")
        ? {
            columns: [
              { canvas: [{ type: "rect", x: 0, y: s * 0.25, w: s * 0.7, h: s * 0.7, lineWidth: 0.6, lineColor: INK }], width: s * 1.1 },
              { text: glyphs(l.slice(1).trim()), ...extra },
            ],
          }
        : { text: glyphs(l), ...extra },
    ),
  };
}

interface Ctx {
  base: number;
  /** The width the content flows in, for rules and form lines. */
  width: number;
  layout: Doc["layout"];
}

function line(width: number, color: string, thickness = 0.5): ContentCanvas {
  return { canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: thickness, lineColor: color }] };
}

function block(b: Block, ctx: Ctx, previous?: Block): Content {
  const s = ctx.base;
  switch (b.kind) {
    case "heading":
      if (b.level === 1) return { text: glyphs(b.text), fontSize: s * 1.6, bold: true, margin: [0, s * 1.4, 0, s * 0.4], headlineLevel: 1 };
      if (b.level === 2)
        return {
          stack: [{ text: glyphs(b.text), fontSize: s * 1.25, bold: true, margin: [0, 0, 0, 2] }, line(ctx.width, HAIR)],
          margin: [0, ctx.layout === "card" ? s * 0.9 : s * 1.6, 0, s * 0.5],
          unbreakable: true,
          headlineLevel: 2,
        };
      return { text: glyphs(b.text), fontSize: s * 1.05, bold: true, margin: [0, s * 1.1, 0, s * 0.3], headlineLevel: 3 };
    case "paragraph":
      if (b.tone === "muted") return { ...lines(b.text, s, { color: MUTED, fontSize: s * 0.92 }), margin: [0, 0, 0, s * 0.6] };
      if (b.tone === "note")
        return {
          table: { widths: ["*"], body: [[{ ...lines(b.text, s, { color: NOTE }), margin: [8, 0, 0, 0] }]] },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: (i) => (i === 0 ? 2 : 0),
            vLineColor: () => NOTE_BAR,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
          },
          margin: [0, 0, 0, s * 0.7],
        };
      return { ...lines(b.text, s), margin: [0, 0, 0, s * 0.6] };
    case "list": {
      const items = b.items.map((i) => lines(i, s));
      return b.ordered ? { ol: items, margin: [0, 0, 0, s * 0.8] } : { ul: items, margin: [0, 0, 0, s * 0.8] };
    }
    case "table": {
      const compact = b.compact === true;
      const cell = s * (compact ? 0.85 : 0.95);
      const header: TableCell[] = b.columns.map((c) => ({ text: glyphs(c).toUpperCase(), fontSize: s * 0.7, characterSpacing: 0.4, color: MUTED, bold: true }));
      const rows: TableCell[][] = b.rows.map((r) => r.map((c, i) => ({ ...lines(c, s, { fontSize: cell }), ...(i === 0 && c.length <= 24 ? { noWrap: true } : {}) }) as TableCell));
      return {
        table: { headerRows: 1, widths: columnWidths(b.columns, b.rows), body: [header, ...rows], dontBreakRows: true },
        layout: {
          hLineWidth: () => 0.5,
          hLineColor: () => HAIR_LIGHT,
          vLineWidth: () => 0,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => (compact ? 1.5 : 3),
          paddingBottom: () => (compact ? 1.5 : 3),
        },
        margin: [0, 0, 0, s * 0.9],
      };
    }
    case "terms":
      return {
        stack: b.items.flatMap((t): Content[] => [{ text: glyphs(t.term), bold: true, margin: [0, s * 0.4, 0, 0] }, lines(t.text, s)]),
        margin: [0, 0, 0, s * 0.9],
      };
    case "form": {
      const fields = form(b.fields, ctx);
      // One form after another: a dashed line between them, as on the sheet.
      if (previous?.kind !== "form") return fields;
      return { stack: [{ canvas: [{ type: "line", x1: 0, y1: 0, x2: ctx.width, y2: 0, lineWidth: 0.5, lineColor: HAIR, dash: { length: 3, space: 3 } }], margin: [0, 0, 0, s * 0.6] }, fields] };
    }
    case "rule":
      return { ...line(ctx.width, HAIR), margin: [0, s * 1.2, 0, s * 1.2] };
    case "pagebreak":
      return { text: "", pageBreak: "after" };
  }
}

/**
 * A column sized to its content when every cell is short (a roll, a name,
 * a range); the columns with sentences share what is left. The last column
 * always flexes, so a table of short columns still fills its width.
 */
function columnWidths(columns: string[], rows: string[][]): Array<"auto" | "*"> {
  return columns.map((_, i) => {
    if (i === columns.length - 1) return "*";
    const longest = rows.reduce((n, r) => Math.max(n, (r[i] ?? "").length), 0);
    return longest <= 28 ? "auto" : "*";
  });
}

/**
 * A form to write on: labels beside lines, boxes for a checkmark or a count,
 * several lines for a note. Short fields sit three to a row, long ones two,
 * a full one alone; the rows are what the flex-wrap in the HTML would do.
 */
function form(fields: Array<{ label: string; width?: "short" | "long" | "full"; lines?: number; box?: boolean }>, ctx: Ctx): Content {
  const s = ctx.base;
  const rows: Content[] = [];
  let row: Column[] = [];
  let used = 0;
  const flush = () => {
    if (row.length) rows.push({ columns: row, columnGap: 14, margin: [0, 0, 0, s * 0.5] });
    row = [];
    used = 0;
  };
  for (const f of fields) {
    const width = f.width ?? "short";
    const share = width === "full" ? 1 : width === "long" ? 1 / 2 : 1 / 3;
    if (used + share > 1.001) flush();
    const labelText: Content = { text: glyphs(f.label), fontSize: s * 0.85, color: MUTED, margin: [0, 0, 0, 2] };
    let field: Column;
    if (f.box) {
      field = { columns: [{ ...labelText, width: "auto", margin: [0, 6, 6, 0] }, { canvas: [{ type: "rect", x: 0, y: 0, w: 22, h: 16, lineWidth: 0.8, lineColor: INK }], width: 22 }], width: "auto" };
    } else {
      const count = f.lines && f.lines > 1 ? f.lines : 1;
      const lines: Content[] = [];
      for (let i = 0; i < count; i++) lines.push({ ...line(width === "short" ? 90 : width === "long" ? 200 : ctx.width, INK, 0.6), margin: [0, s * 1.7, 0, 0] });
      field = { stack: [labelText, ...lines], width: width === "full" ? "*" : "auto", unbreakable: true };
    }
    row.push(field);
    used += share;
    if (width === "full") flush();
  }
  flush();
  // A form is one thing to fill in; it does not straddle a page.
  return { stack: rows, margin: [0, 0, 0, s * 0.4], unbreakable: true };
}

/** A rough height for a block, in lines of the base size, to balance the card's columns. */
function weight(b: Block, ctx: Ctx): number {
  const perLine = Math.max(20, Math.floor(ctx.width / (ctx.base * 0.5)));
  const linesOf = (t: string) => t.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  switch (b.kind) {
    case "heading":
      return 2.2;
    case "paragraph":
      return linesOf(b.text) + 0.6;
    case "list":
      return b.items.reduce((n, i) => n + linesOf(i), 0) + 0.8;
    case "table":
      return 1.4 + b.rows.reduce((n, r) => n + Math.max(...r.map((c) => Math.max(1, Math.ceil(c.length / (perLine / r.length))))), 0) * (b.compact ? 0.85 : 1);
    case "terms":
      return b.items.reduce((n, t) => n + 1 + linesOf(t.text), 0) + 0.9;
    case "form":
      return Math.ceil(b.fields.length / 2) * 2.5;
    case "rule":
      return 2.4;
    case "pagebreak":
      return 0;
  }
}

/**
 * The card's blocks as sections (a level-two heading and what follows it),
 * dealt one by one into the lighter of two columns.
 */
function dealIntoColumns(blocks: Block[], ctx: Ctx): Content[] {
  const sections: Block[][] = [];
  for (const b of blocks) {
    if (b.kind === "heading" && b.level <= 2) sections.push([b]);
    else if (sections.length === 0) sections.push([b]);
    else sections[sections.length - 1]!.push(b);
  }
  const left: Content[] = [];
  const right: Content[] = [];
  let leftWeight = 0;
  let rightWeight = 0;
  for (const section of sections) {
    const w = section.reduce((n, b) => n + weight(b, ctx), 0);
    const content = section.map((b) => block(b, ctx));
    if (leftWeight <= rightWeight) {
      left.push(...content);
      leftWeight += w;
    } else {
      right.push(...content);
      rightWeight += w;
    }
  }
  return [{ columns: [{ stack: left, width: "*" }, { stack: right, width: "*" }], columnGap: 24 }];
}

/** The faces a renderer must register under the name "Literata". */
export const FACES = ["400-normal", "700-normal", "400-italic", "700-italic"] as const;
export type Face = (typeof FACES)[number];

export function fontDictionary(file: (face: Face) => string): TFontDictionary {
  return { Literata: { normal: file("400-normal"), bold: file("700-normal"), italics: file("400-italic"), bolditalics: file("700-italic") } };
}

export async function renderPdf(doc: Doc, engine: PdfEngine): Promise<Uint8Array> {
  const bytes = await engine.createPdf(toPdfDefinition(doc)).getBuffer();
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}
