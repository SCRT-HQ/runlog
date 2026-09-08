import type { Table } from "@runlog/rules-schema";

/**
 * A table as a list a player can read beside the keypad: each line, the
 * numbers that land on it, and one number that would.
 *
 * With Roll for me off the engine asks for every number, and the number a
 * player types is their own dice. Showing the table they are rolling
 * against does two things at once: a person who wants to see what could
 * happen can, and a person testing a pack can put the dice on any line by
 * pressing it. Nothing is hidden and nothing is faked; the log says the
 * number was typed, because it was.
 */
export interface TableLine {
  id: string;
  /** "21–40", "80+", "up to 19". */
  range: string;
  /** The lowest number that lands on this line, for the keypad. */
  value: number;
  title: string;
}

export function tableLines(table: Table, dice: { min: number; max: number } | null): TableLine[] {
  if (table.resolution === "lookup") {
    return table.entries.map((e) => ({
      id: e.id,
      range: e.range[0] === e.range[1] ? String(e.range[0]) : `${e.range[0]}–${e.range[1]}`,
      value: e.range[0],
      title: e.title ?? e.text,
    }));
  }
  if (table.resolution === "bands") {
    return table.entries.map((e) => {
      const lo = e.gte ?? dice?.min ?? 1;
      const range = e.gte !== undefined && e.lte !== undefined ? `${e.gte}–${e.lte}` : e.gte !== undefined ? `${e.gte}+` : e.lte !== undefined ? `up to ${e.lte}` : "any";
      return { id: e.id, range, value: lo, title: e.title ?? e.text };
    });
  }
  // An opposed table is beaten a number of times, not landed on; a keyed
  // one is chosen, not rolled. Neither is a list of numbers.
  return [];
}

/** Which line a number would land on, if any. */
export function lineFor(lines: TableLine[], table: Table, total: number): string | null {
  if (table.resolution === "lookup") return table.entries.find((e) => total >= e.range[0] && total <= e.range[1])?.id ?? null;
  if (table.resolution === "bands") return table.entries.find((e) => (e.gte ?? -Infinity) <= total && total <= (e.lte ?? Infinity))?.id ?? null;
  return lines.find((l) => l.value === total)?.id ?? null;
}
