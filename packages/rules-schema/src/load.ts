import { parse as parseYaml } from "yaml";
import { parsePack, type ParseResult } from "./parse.ts";

/**
 * Loading packs from text.
 *
 * YAML is the authoring format: hand-writing a hundred-entry table in JSON is
 * miserable, and comments matter when you are transcribing a rulebook. JSON is
 * the distribution format, because it is what the app stores and what a
 * release pipeline can hash. Both land in the same validator.
 */

export type PackFormat = "yaml" | "json";

export function detectFormat(filename: string): PackFormat {
  return /\.ya?ml$/i.test(filename) ? "yaml" : "json";
}

export function loadPackText(text: string, format: PackFormat): ParseResult {
  let raw: unknown;
  try {
    raw = format === "yaml" ? parseYaml(text) : JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      pack: null,
      diagnostics: [
        {
          level: "error",
          code: `parse/${format}`,
          path: "",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ],
    };
  }
  return parsePack(raw);
}
