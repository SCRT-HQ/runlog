import { DOC_KINDS, generateDoc, toHtml, toMarkdown, type Doc, type Pack } from "@runlog/rules-schema";
import { zip, type ZipEntry } from "../docs/zip.ts";

/**
 * A distribution bundle: everything a buyer, or a shop, gets in one file.
 *
 * The pack itself — signed, or sealed for one buyer — and every document
 * written from it, each as a PDF, as HTML and as Markdown, with a short
 * note on what is what. The license key for a sealed copy is
 * never in here: the bundle is the thing that gets passed around, and the
 * key is what makes a copy someone's own, so they travel separately.
 */
export interface BundleInput {
  pack: Pack;
  /** The pack file to ship: its name in the archive and its bytes or text. */
  file: { name: string; data: string | Uint8Array };
  /** Set when the file is a sealed copy. */
  sealed?: { to: string; reference?: string };
  /** Renders a document to PDF; without it the bundle carries HTML and Markdown only. */
  pdf?: (doc: Doc) => Promise<Uint8Array>;
}

export async function bundleEntries({ pack, file, sealed, pdf }: BundleInput): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [{ name: "README.md", data: readme({ pack, file, sealed, pdf }) }, file];
  for (const k of DOC_KINDS) {
    const doc = generateDoc(pack, k.kind);
    if (pdf) entries.push({ name: `docs/${k.kind}.pdf`, data: await pdf(doc) });
    entries.push({ name: `docs/${k.kind}.html`, data: toHtml(doc) });
    entries.push({ name: `docs/${k.kind}.md`, data: toMarkdown(doc) });
  }
  return entries;
}

export async function bundle(input: BundleInput): Promise<Uint8Array> {
  return zip(await bundleEntries(input));
}

/** The bundle's file name, beside the pack file's own. */
export function bundleFilename(packFile: string): string {
  return `${packFile.replace(/\.(yaml|json|rlpack)$/, "")}-bundle.zip`;
}

function readme({ pack, file, sealed, pdf }: BundleInput): string {
  const lines = [
    `# ${pack.title}`,
    "",
    `Version ${pack.version}${pack.author ? `, by ${pack.author}` : ""}.${pack.description ? ` ${pack.description}` : ""}`,
    "",
    "## What is in here",
    "",
  ];
  if (sealed) {
    lines.push(
      `- \`${file.name}\`: the pack, sealed for ${sealed.to}${sealed.reference ? ` (order ${sealed.reference})` : ""}. It opens with the license key that came with it, which is not in this bundle; keep the key where you keep such things.`,
    );
  } else {
    lines.push(`- \`${file.name}\`: the pack, signed by its author. Loading it in Runlog shows who signed it; an altered copy will not.`);
  }
  for (const k of DOC_KINDS) lines.push(`- ${pdf ? `\`docs/${k.kind}.pdf\`, ` : ""}\`docs/${k.kind}.html\` and \`docs/${k.kind}.md\`: ${k.label.toLowerCase()}. ${k.what}`);
  lines.push(
    "",
    "## Reading and playing",
    "",
    pdf ? "The PDFs are for reading and printing. The HTML is the same document for a browser, and the Markdown the same text for editing or pasting." : "Open an HTML file in a browser to read it, and print it there for a PDF. The Markdown is the same text for editing or pasting.",
    "",
    `To play, open Runlog, choose **Load a pack from a file**, and pick \`${file.name}\`.${sealed ? " Type the license key once; signed in, it is kept in your account so the pack opens on your other devices too." : ""}`,
    "",
    `The pack is ${pack.license.redistributable ? "free to pass on under its license" : "not for redistribution"} (${pack.license.id}).`,
    "",
  );
  return lines.join("\n");
}
