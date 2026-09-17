import { loadSetupText, whichKind, type Setup } from "@runlog/rules-schema";
import { listSetups, saveSetup } from "./db.ts";

/**
 * A chosen file, read before anybody is told what it is.
 *
 * Two doors take a file: the library's `Load a pack from a file` and the
 * setups section under Settings. Neither can assume the person picked the
 * document that door is named for, so both read the file the same way and
 * route on what the document says rather than on what the door is called.
 * Keeping that in one module is the point: two answers to "is this a
 * setup?" would drift apart, and the wrong one refuses a good file.
 */

/** The format a name implies: JSON by its extension, YAML otherwise. */
export const formatOfName = (name: string): "yaml" | "json" => (/\.json$/i.test(name) ? "json" : "yaml");

export interface ReadDocument {
  text: string;
  format: "yaml" | "json";
  kind: ReturnType<typeof whichKind>;
}

/** A file's text, its format, and which kind of document it holds. */
export async function readDocumentFile(file: File): Promise<ReadDocument> {
  const text = await file.text();
  const format = formatOfName(file.name);
  return { text, format, kind: whichKind(text, format) };
}

export type KeptSetup = { ok: true; setup: Setup; replaced: boolean } | { ok: false; message: string };

/**
 * A setup, kept.
 *
 * A file with the same id replaces the one already here and keeps the
 * date it first arrived, so taking a newer version of a setup is not a
 * second copy of it. The text is stored as it arrived, so a later build
 * that understands more of the format than this one can read it again.
 */
export async function keepSetup(text: string, format: "yaml" | "json", filename: string): Promise<KeptSetup> {
  const parsed = loadSetupText(text, format);
  if (!parsed.ok) {
    const first = parsed.diagnostics.find((d) => d.level === "error");
    return {
      ok: false,
      message: first ? `${filename} did not load: ${first.path ? `${first.path}: ` : ""}${first.message}` : `${filename} did not load.`,
    };
  }

  const setup = parsed.setup;
  const at = new Date().toISOString();
  const had = (await listSetups()).find((k) => k.id === setup.id);
  await saveSetup({
    id: setup.id,
    title: setup.title,
    version: setup.version,
    tool: setup.tool,
    ...(setup.description ? { description: setup.description } : {}),
    ...(setup.author ? { author: setup.author } : {}),
    source: text,
    format,
    importedAt: had?.importedAt ?? at,
    updatedAt: at,
  });
  return { ok: true, setup, replaced: Boolean(had) };
}
