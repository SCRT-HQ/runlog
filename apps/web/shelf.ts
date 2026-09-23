import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { Plugin } from "vite";

/**
 * The bundled packs' names, read at build time.
 *
 * The welcome page's pack shelf shows each pack that ships with a title and
 * a line about it. Reading those out of the marketplace meant loading every
 * bundled pack's whole file, nine chunks and the test bench, on a page that
 * shows one example. So the shelf's few words are read here, once, from
 * the same files the marketplace globs, and handed to the page as a module
 * of their own. The marketplace still reads the files themselves.
 */
const from = fileURLToPath(new URL("../../packs/sketches", import.meta.url));

/** What the shelf shows of one pack that ships. */
export interface ShelfHead {
  id: string;
  title: string;
  description?: string;
}

export const SHELF_MODULE = "virtual:runlog-shelf";
const RESOLVED = `\0${SHELF_MODULE}`;

/** Read one pack's header the way the marketplace does: an id, a title that falls back to it, a trimmed description. */
export function shelfHead(text: string): ShelfHead | null {
  const head = YAML.parse(text) as Record<string, unknown>;
  const id = String(head["id"] ?? "");
  if (!id) return null;
  return {
    id,
    title: String(head["title"] ?? id),
    ...(typeof head["description"] === "string" ? { description: head["description"].trim() } : {}),
  };
}

/** Every pack under packs/sketches, by file name, as the marketplace's glob orders them. */
export function shelfHeads(dir = from): ShelfHead[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => shelfHead(readFileSync(join(dir, name), "utf8")))
    .filter((head): head is ShelfHead => head !== null);
}

export function shelf(dir = from): Plugin {
  return {
    name: "runlog-shelf",
    resolveId(id) {
      return id === SHELF_MODULE ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      // Watched, so the dev server picks up a pack whose title changed.
      for (const name of readdirSync(dir)) if (name.endsWith(".yaml")) this.addWatchFile(join(dir, name));
      return `export default ${JSON.stringify(shelfHeads(dir))};`;
    },
  };
}
