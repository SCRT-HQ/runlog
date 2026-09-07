import type { Doc } from "@runlog/rules-schema";
import { fontDictionary, renderPdf, type Face, type PdfEngine } from "./pdf.ts";
import literata400 from "@fontsource/literata/files/literata-latin-400-normal.woff?url";
import literata700 from "@fontsource/literata/files/literata-latin-700-normal.woff?url";
import literata400i from "@fontsource/literata/files/literata-latin-400-italic.woff?url";
import literata700i from "@fontsource/literata/files/literata-latin-700-italic.woff?url";

/**
 * pdfmake in the browser, loaded the first time a PDF is asked for.
 *
 * The library is a megabyte, so it is its own chunk and the app never
 * pays for it until someone presses PDF. The fonts are Literata's static
 * faces (the app's stylesheet uses the variable one, which fontkit will not
 * subset), fetched from this origin by the library itself; nothing leaves
 * the browser.
 */
const FILES: Record<Face, string> = { "400-normal": literata400, "700-normal": literata700, "400-italic": literata400i, "700-italic": literata700i };

let engine: Promise<PdfEngine> | undefined;

function loadEngine(): Promise<PdfEngine> {
  engine ??= import("pdfmake").then((mod) => {
    // A UMD build: the object is the default export, or the module itself.
    const pdfmake = ((mod as { default?: unknown }).default ?? mod) as PdfEngine & { setUrlAccessPolicy(cb: (url: string) => boolean): void };
    pdfmake.setUrlAccessPolicy((url) => url.startsWith(location.origin));
    pdfmake.setFonts(fontDictionary((face) => new URL(FILES[face], location.href).href));
    return pdfmake;
  });
  return engine;
}

export async function docToPdf(doc: Doc): Promise<Uint8Array> {
  return renderPdf(doc, await loadEngine());
}
