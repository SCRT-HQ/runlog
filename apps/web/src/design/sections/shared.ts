import type { Diagnostic } from "@runlog/rules-schema";
import type { Draft } from "../draft.ts";

/**
 * What every section of the editor is handed.
 *
 * One draft lives above them all, in `DesignView`, and a section never
 * holds a copy of it: it reads the draft it is given and writes through
 * `edit`, the single path by which the draft changes. That is what makes
 * moving between sections free, since there is nothing in a section to
 * save or to lose on the way out.
 */
export interface SectionProps {
  draft: Draft;
  diagnostics: Diagnostic[];
  edit: (path: (string | number)[], value: unknown) => void;
}

/** Read a value at a path, tolerating anything missing on the way down. */
export function get(draft: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = draft;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const num = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);
