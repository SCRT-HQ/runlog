import type { RunState } from "@runlog/engine";

/**
 * What is ticked on a step, read back from the log by its key.
 *
 * A step's boxes live in `state.checks` as `"<key>|<item>"`, so a reload lands
 * on the same boxes and a shared run agrees on them. Both the page's step
 * card and the floating remote need this same set, computed the same way —
 * lifted here so neither can drift from the other.
 */
export function ticksFor(state: RunState, key: string): Set<string> {
  const prefix = `${key}|`;
  return new Set(state.checks.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)));
}
