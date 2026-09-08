import type { LiveSnapshot } from "./snapshot.ts";

/**
 * What moved between two snapshots, for the live page to show moving.
 *
 * A watcher is not pressing anything, so the page has to say for itself
 * that something happened: a unit turned, a line landed in the log, a
 * result reached back and struck a piece, a state was put on, a number
 * changed. Each is a set of keys the page turns into a class for one
 * render; the first snapshot moves nothing, since nothing came before it.
 */
export interface Motion {
  /** The unit changed. */
  turned: boolean;
  /** Log lines numbered above this are new. Infinity on the first snapshot. */
  freshFrom: number;
  /** Subjects a new line reached back to. */
  struck: Set<number>;
  /** `${subject}:${state}` for states not held before. */
  states: Set<string>;
  counters: Set<string>;
  resources: Set<string>;
}

export const STILL: Motion = { turned: false, freshFrom: Infinity, struck: new Set(), states: new Set(), counters: new Set(), resources: new Set() };

export function motionBetween(prev: LiveSnapshot | null, next: LiveSnapshot): Motion {
  if (!prev) return STILL;
  const freshFrom = Math.max(0, ...prev.log.map((l) => l.n));
  const struck = new Set<number>();
  for (const line of next.log) if (line.n > freshFrom && line.hit !== null) struck.add(line.hit);
  const held = new Map(prev.subjects.map((s) => [s.id, new Set(s.states)]));
  const states = new Set<string>();
  for (const s of next.subjects) for (const st of s.states) if (!held.get(s.id)?.has(st)) states.add(`${s.id}:${st}`);
  const was = (list: Array<{ id: string; value: number }>) => new Map(list.map((x) => [x.id, x.value]));
  const changed = (before: Map<string, number>, after: Array<{ id: string; value: number }>) => new Set(after.filter((x) => before.has(x.id) && before.get(x.id) !== x.value).map((x) => x.id));
  return {
    turned: prev.unit !== next.unit,
    freshFrom,
    struck,
    states,
    counters: changed(was(prev.counters), next.counters),
    resources: changed(was(prev.resources), next.resources),
  };
}
