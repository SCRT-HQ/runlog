import type { Pack } from "@runlog/rules-schema";
import { progressOf, subjectName, type RunEvent, type RunState } from "@runlog/engine";
import { entryTextOf } from "../live/snapshot.ts";

/**
 * What just happened at the table, told to whoever is watching.
 *
 * The socket says "changed" when the run moves, and a watcher fetches the
 * state; that is enough to draw a scoreboard, and useless for an alert. A
 * ticker, a sound, a scene change in a streaming tool wants to be told
 * *what* moved, a result landed, a unit closed, the run ended, the moment
 * it did, in words, without reducing anything. Gestures are that channel:
 * passed through the socket, stored nowhere, the way the dice already
 * travel.
 *
 * They are read from the state before and after a move rather than from
 * the events, for two reasons. An undo shortens the log and voids events
 * in it; a count that went down is nothing to announce. And a move that
 * arrived from another device through sync is the same news as one made
 * here, so the owner's device announces every move at its table, whoever
 * made it, and no other device announces any: one voice per table.
 */
export interface LifecycleMarks {
  outcomes: number;
  unitsDone: number;
  ended: boolean;
  awards: number;
  clocks: Record<string, "running" | "paused" | "done">;
}

export type LifecycleKind = "outcome" | "unit-closed" | "run-ended" | "award" | "clock";

export interface LifecycleGesture {
  kind: LifecycleKind;
  data: Record<string, unknown>;
}

/** Where the run stands, in the counts a later reading is compared against. */
export function marksOf(state: RunState, events: readonly RunEvent[], nowMs: number = Date.now()): LifecycleMarks {
  return {
    outcomes: state.outcomes.length,
    unitsDone: progressOf(state, events, nowMs).unitsDone,
    ended: state.status === "ended",
    awards: state.awards.length,
    clocks: Object.fromEntries(state.clocks.map((c) => [c.id, c.status])),
  };
}

/**
 * The gestures a move produced: everything `state` has that `before` did
 * not, in the pack's own words. Results first, then awards on them, then
 * the clocks, then the unit closing, then the run ending, which is the
 * order the table would say them in.
 */
export function lifecycleGestures(pack: Pack, state: RunState, events: readonly RunEvent[], before: LifecycleMarks, nowMs: number = Date.now()): LifecycleGesture[] {
  const out: LifecycleGesture[] = [];
  const now = marksOf(state, events, nowMs);
  const tableTitle = (id: string) => pack.tables[id]?.title ?? id;

  // Numbered from the start of the run, the way the snapshot's log numbers
  // them, so a listener can drop a line it has already shown.
  for (let i = before.outcomes; i < state.outcomes.length; i++) {
    const o = state.outcomes[i]!;
    const subject = o.targetSubject === null || o.targetSubject === undefined ? undefined : state.subjects.find((s) => s.id === o.targetSubject);
    out.push({
      kind: "outcome",
      data: {
        n: i + 1,
        unit: o.unit,
        table: tableTitle(o.table),
        text: entryTextOf(pack, o),
        ...(subject ? { subject: subjectName(pack, subject) } : {}),
      },
    });
  }

  for (let i = before.awards; i < state.awards.length; i++) {
    const a = state.awards[i]!;
    const who = state.contestants.find((c) => c.id === a.contestant);
    out.push({
      kind: "award",
      data: { n: a.outcome + 1, contestant: who?.name ?? a.contestant, points: a.points, table: tableTitle(a.table), text: entryTextOf(pack, a) },
    });
  }

  for (const c of state.clocks) {
    const was = before.clocks[c.id];
    const status = c.status === "done" ? (was === "done" ? null : "stopped") : c.status === "paused" ? (was === "paused" ? null : "paused") : was === undefined ? "started" : was === "paused" ? "resumed" : null;
    if (!status) continue;
    out.push({ kind: "clock", data: { clock: c.id, label: c.label, kind: c.kind, status, ...(status === "stopped" ? { expired: Boolean(c.expired) } : {}) } });
  }

  if (now.unitsDone > before.unitsDone) {
    out.push({ kind: "unit-closed", data: { unit: state.unit, unitsDone: now.unitsDone } });
  }

  if (now.ended && !before.ended) {
    out.push({ kind: "run-ended", data: { ending: state.ending, unitsDone: now.unitsDone } });
  }

  return out;
}
