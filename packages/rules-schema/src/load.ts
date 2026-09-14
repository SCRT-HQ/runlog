import { parse as parseYaml } from "yaml";
import { parsePack, type ParseResult } from "./parse.ts";
import { parseSetup, looksLikeSetup, type SetupResult } from "./setup.ts";
import { parseMapping, looksLikeMapping, type MappingResult } from "./mapping.ts";

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

/**
 * A setup from text, the same way and for the same reasons.
 *
 * Split from `loadPackText` rather than folded into it because the
 * answers are different shapes and a caller always knows which it wants.
 * A caller that does not know is holding a file somebody handed them,
 * and `whichKind` is for them.
 */
export function loadSetupText(text: string, format: PackFormat): SetupResult {
  let raw: unknown;
  try {
    raw = format === "yaml" ? parseYaml(text) : JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      setup: null,
      diagnostics: [{ level: "error", code: `parse/${format}`, path: "", message: cause instanceof Error ? cause.message : String(cause) }],
    };
  }
  return parseSetup(raw);
}

/**
 * What a file is, for anything that takes one and has to decide.
 *
 * A pack has never carried a `kind`, and adding one to every pack ever
 * written is not worth it, so the absence of one is what says pack. That
 * is why `kind` is required on a setup: the new thing declares itself,
 * and the old thing does not have to be changed to keep working.
 */
export function whichKind(text: string, format: PackFormat): "pack" | "setup" | "mapping" | "unreadable" {
  try {
    const raw = format === "yaml" ? parseYaml(text) : JSON.parse(text);
    if (looksLikeSetup(raw)) return "setup";
    if (looksLikeMapping(raw)) return "mapping";
    return "pack";
  } catch {
    return "unreadable";
  }
}

/**
 * A mapping from text, the same way and for the same reasons as a setup.
 */
export function loadMappingText(text: string, format: PackFormat): MappingResult {
  let raw: unknown;
  try {
    raw = format === "yaml" ? parseYaml(text) : JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      mapping: null,
      diagnostics: [{ level: "error", code: `parse/${format}`, path: "", message: cause instanceof Error ? cause.message : String(cause) }],
    };
  }
  return parseMapping(raw);
}
