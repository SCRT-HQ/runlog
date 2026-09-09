import type { RunEvent } from "@runlog/engine";
import { hashText } from "./hash.ts";

/**
 * A device's copy of a shared log.
 *
 * It is two parts, in order: the events the server has numbered, in the
 * server's order, and then the events this device has made and not yet
 * had numbered. Sync sends the second part and takes back whatever the
 * server has past what this device last saw; `merge` puts the two back
 * together. Nothing is ever dropped from the first part, and nothing is
 * dropped from the second until the server has given it a number: an
 * event this device made is either pending or confirmed, never lost.
 */

/** The highest sequence number in a log; zero for one the server has never seen. */
export function tailSeq(events: readonly RunEvent[]): number {
  let max = 0;
  for (const e of events) if (typeof e.seq === "number" && e.seq > max) max = e.seq;
  return max;
}

/** The events the server has not numbered yet: this device's outbox. */
export function pendingEvents(events: readonly RunEvent[]): RunEvent[] {
  return events.filter((e) => e.seq === undefined);
}

/**
 * Fold what the server sent into what is here.
 *
 * Confirmed events are the union of both sides' numbered events, by id,
 * in sequence order: the server's copy of an event wins, since it carries
 * the number and the author. Pending events stay pending unless the server
 * has now numbered them, in which case they moved into the first part.
 */
export function merge(local: readonly RunEvent[], incoming: readonly RunEvent[]): RunEvent[] {
  const confirmed = new Map<string, RunEvent>();
  for (const e of local) if (e.seq !== undefined && e.id) confirmed.set(e.id, e);
  for (const e of incoming) if (e.seq !== undefined && e.id) confirmed.set(e.id, e);
  const ordered = [...confirmed.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const pending = local.filter((e) => e.seq === undefined && !(e.id && confirmed.has(e.id)));
  return [...ordered, ...pending];
}

/**
 * Give an old log its ids.
 *
 * Events from before ids have none, and a shared log needs one on every
 * event. The id is derived from the run, the event's place, and the event
 * itself, so two devices holding the same old log derive the same ids and
 * the server keeps each event once. Returns the same array when nothing
 * was missing, so a caller can tell whether to save.
 */
export async function stampIds(runId: string, events: readonly RunEvent[]): Promise<RunEvent[]> {
  if (events.every((e) => typeof e.id === "string")) return events as RunEvent[];
  const out: RunEvent[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (typeof e.id === "string") {
      out.push(e);
      continue;
    }
    const id = `L${await hashText(`${runId}:${i}:${JSON.stringify(e)}`)}`;
    out.push({ ...e, id });
  }
  return out;
}

/** The last name the log gave the run, for the server's list. */
export function nameFrom(events: readonly RunEvent[]): string | undefined {
  let name: string | undefined;
  for (const e of events) if (e.t === "RunRenamed") name = e.name.trim() || undefined;
  return name;
}

/**
 * What a device writes back after a move.
 *
 * The run hook holds the log as it plays it; storage holds the log as sync
 * last left it, which may carry numbers the hook has not seen. Writing the
 * hook's copy over the top would lose those. So: the stored confirmed part
 * stands, and the hook's unnumbered events follow it, minus any the server
 * has since numbered.
 */
export function reconcile(stored: readonly RunEvent[], mine: readonly RunEvent[]): RunEvent[] {
  const confirmed = stored.filter((e) => e.seq !== undefined);
  const known = new Set(confirmed.map((e) => e.id));
  const pending = mine.filter((e) => e.seq === undefined && !(e.id && known.has(e.id)));
  return [...confirmed, ...pending];
}
