import type { Diagnostic } from "@runlog/rules-schema";

/**
 * The six parts of the editor, and which of them owns a problem.
 *
 * The editor used to be one page you scrolled, so a problem in a table
 * and a problem in the license were the same distance away: the bottom.
 * Split into sections, the count beside each name is the only thing that
 * says where the work is, so ownership has to be decided in one place
 * rather than guessed at by each panel.
 *
 * Ownership is by the first segment of a diagnostic's dotted path, which
 * is the same path the field carrying the error is keyed by. Anything
 * structural, and anything with no path at all, belongs to Test: that is
 * the section that lists the whole report.
 */
export type Section = "overview" | "tables" | "flow" | "modes" | "test" | "publish";

export const SECTIONS: ReadonlyArray<{ id: Section; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tables", label: "Tables" },
  { id: "flow", label: "Flow" },
  { id: "modes", label: "Modes" },
  { id: "test", label: "Test" },
  { id: "publish", label: "Publish" },
];

const OWNER: Readonly<Record<string, Section>> = {
  title: "overview",
  id: "overview",
  version: "overview",
  author: "overview",
  category: "overview",
  tags: "overview",
  description: "overview",
  requires: "overview",
  vocabulary: "overview",
  tables: "tables",
  phases: "flow",
  unit: "flow",
  modes: "modes",
  defaultMode: "modes",
  players: "modes",
  license: "publish",
  signature: "publish",
  issue: "publish",
};

/** Which section a dotted path belongs to, read from its first segment. */
export function sectionOfPath(path: string): Section {
  const root = /^[^.[]*/.exec(path)?.[0] ?? "";
  return OWNER[root] ?? "test";
}

export interface SectionCount {
  errors: number;
  warnings: number;
}

/** How many errors and warnings each section owns. */
export function countBySection(diagnostics: readonly Diagnostic[]): Record<Section, SectionCount> {
  const counts = Object.fromEntries(SECTIONS.map((s) => [s.id, { errors: 0, warnings: 0 }])) as Record<Section, SectionCount>;
  for (const d of diagnostics) {
    const owner = counts[sectionOfPath(d.path)];
    if (d.level === "error") owner.errors++;
    else owner.warnings++;
  }
  return counts;
}

/** The section an address names: `#create/tables` is Tables, `#create` is the first one. */
export function asSection(segment: string | null): Section {
  const found = SECTIONS.find((s) => s.id === segment);
  return found ? found.id : "overview";
}

/** The address a section is spelled at. */
export function hashForSection(section: Section): string {
  return section === "overview" ? "#create" : `#create/${section}`;
}
