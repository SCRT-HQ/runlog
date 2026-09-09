import type { RunEvent } from "./events.ts";

/**
 * The log as it is, and the log as it counts.
 *
 * A log is append-only once it can be shared: nothing is ever taken out,
 * because another player may already have built on it. Undo is therefore
 * an event of its own, `Undone`, naming the events it voids by id; and what
 * the reducer folds is the *effective* log: every event that is neither
 * an `Undone` nor named by one. Everything that reads a log for meaning
 * (the reducer, the export) reads it through here; everything that stores
 * or sends one keeps the whole thing.
 *
 * Events made before ids existed have none. They can still be folded; they
 * cannot be undone by event, which is why the app stamps a deterministic id
 * onto them the first time it loads such a log.
 */

/** Ids named as void by every `Undone` in the log. */
export function voidedIds(events: readonly RunEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.t === "Undone") for (const id of e.ids) out.add(id);
  }
  return out;
}

/** The events that count: no `Undone`, and nothing an `Undone` named. */
export function effectiveEvents(events: readonly RunEvent[]): RunEvent[] {
  const gone = voidedIds(events);
  return events.filter((e) => e.t !== "Undone" && (e.id === undefined || !gone.has(e.id)));
}

/**
 * The ids the next undo would void: the most recent player-visible move.
 *
 * Where the log names its moves, the move is the batch the last event
 * belongs to: everything committed together, however many events that is
 * and whatever kinds they are. Older logs name no moves, and for them the
 * move is read
 * from its boundary event to the end of what still counts. Empty when there
 * is nothing left to undo, or when the last move has no ids to name.
 */
export function undoableIds(events: readonly RunEvent[], isBoundary: (e: RunEvent) => boolean): string[] {
  const live = effectiveEvents(events);
  if (live.length <= 1) return [];
  const last = live[live.length - 1]!;
  if (last.move) {
    let cut = live.length - 1;
    while (cut > 1 && live[cut - 1]!.move === last.move) cut -= 1;
    const move = live.slice(cut);
    const ids = move.map((e) => e.id).filter((id): id is string => typeof id === "string");
    return ids.length === move.length ? ids : [];
  }
  let cut = live.length - 1;
  while (cut > 1 && !isBoundary(live[cut]!)) cut -= 1;
  const move = live.slice(cut);
  const ids = move.map((e) => e.id).filter((id): id is string => typeof id === "string");
  return ids.length === move.length ? ids : [];
}
