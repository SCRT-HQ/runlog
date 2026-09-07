import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_KINDS, generateDoc, loadPackText } from "@runlog/rules-schema";
import * as pdfmakeModule from "pdfmake";
import { FACES, fontDictionary, renderPdf, toPdfDefinition, type PdfEngine } from "./pdf.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const r = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!r.ok) throw new Error("could not load the demo pack");
const kiln = r.pack;

/** pdfmake's Node build, with the fonts placed in its virtual file system by name. */
function nodeEngine(): PdfEngine {
  const pdfmake = ((pdfmakeModule as { default?: unknown }).default ?? pdfmakeModule) as PdfEngine & {
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    virtualfs: { writeFileSync(name: string, data: Buffer): void };
  };
  pdfmake.setLocalAccessPolicy(() => false);
  pdfmake.setUrlAccessPolicy(() => false);
  for (const face of FACES) {
    const bytes = readFileSync(join(repoRoot, "node_modules/@fontsource/literata/files", `literata-latin-${face}.woff`));
    pdfmake.virtualfs.writeFileSync(`literata-${face}.woff`, Buffer.from(new Uint8Array(bytes)));
  }
  pdfmake.setFonts(fontDictionary((face) => `literata-${face}.woff`));
  return pdfmake;
}

describe("the PDF writer", () => {
  it("maps each layout onto a page", () => {
    const book = toPdfDefinition(generateDoc(kiln, "rulebook"));
    expect(book.pageSize).toBe("LETTER");
    expect(book.info?.title).toContain(kiln.title);
    const card = toPdfDefinition(generateDoc(kiln, "reference"));
    const content = card.content as unknown as Array<Record<string, unknown>>;
    // Title, byline, then the two columns.
    const columns = content.find((c) => "columns" in c) as { columns: Array<{ stack: unknown[] }> };
    expect(columns.columns).toHaveLength(2);
    expect(columns.columns[0]!.stack.length).toBeGreaterThan(0);
    expect(columns.columns[1]!.stack.length).toBeGreaterThan(0);
    const sheet = toPdfDefinition(generateDoc(kiln, "runlog"));
    expect(JSON.stringify(sheet.content)).toContain('"type":"line"');
  });

  it("renders every document of the demo pack to a real PDF with Literata embedded", async () => {
    const engine = nodeEngine();
    for (const k of DOC_KINDS) {
      const bytes = await renderPdf(generateDoc(kiln, k.kind), engine);
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text).toContain("Literata");
      expect(text).toContain("%%EOF");
    }
  }, 30_000);
});
