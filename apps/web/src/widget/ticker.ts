import { useEffect, useRef, useState } from "react";
import type { LiveSnapshot } from "../live/snapshot.ts";
import type { Gesture } from "../sync/socket.ts";

/**
 * The last few things that happened, one line each: what a ticker on a
 * stream shows while the scoreboard stays still.
 *
 * Lines come from two places, and both are wanted. A gesture arrives the
 * moment something happens and says it in words, but a widget that OBS
 * shut down while off scene, or one that has just opened, heard none of
 * them. So the ticker also reads the difference between one snapshot and
 * the next — a result numbered past the last one seen, a unit closed, a
 * contestant's points moved, a clock that stopped — which is there
 * whenever the widget is, from whichever device wrote the snapshot. A
 * line's id is the same from either source, so a result told by gesture
 * and then read from the snapshot is one line, not two.
 */
export type TickerKind = "rolled" | "outcome" | "award" | "clock" | "unit-closed" | "run-ended";

export interface TickerLine {
  id: string;
  kind: TickerKind;
  /** A word for the kind, in front of the line. */
  mark: string;
  text: string;
}

const MARKS: Record<TickerKind, string> = { rolled: "Rolled", outcome: "Result", award: "Award", clock: "Clock", "unit-closed": "Closed", "run-ended": "Ended" };

const line = (kind: TickerKind, id: string, text: string): TickerLine => ({ id, kind, mark: MARKS[kind], text });

/** What `next` has that `prev` did not, oldest first. Nothing for a first reading: what a widget opens onto is old news. */
export function tickerLines(prev: LiveSnapshot | null, next: LiveSnapshot): TickerLine[] {
  if (!prev) return [];
  const out: TickerLine[] = [];
  const lastSeen = prev.log[0]?.n ?? 0;
  // The log is newest first; new results are the ones numbered past what was seen.
  for (const entry of [...next.log].reverse()) {
    if (entry.n <= lastSeen) continue;
    out.push(line("outcome", `o${entry.n}`, entry.text));
  }
  for (const c of next.standings) {
    const was = prev.standings.find((p) => p.name === c.name);
    if (!was || was.points === c.points) continue;
    const delta = c.points - was.points;
    out.push(line("award", `a${c.name}:${c.points}`, `${c.name} ${delta > 0 ? "+" : ""}${delta} · ${c.points}`));
  }
  for (const c of next.clocks) {
    const was = prev.clocks.find((p) => p.id === c.id);
    const status = c.status === "done" ? (was?.status === "done" ? null : "stopped") : c.status === "paused" ? (was?.status === "paused" ? null : "paused") : !was ? "started" : was.status === "paused" ? "resumed" : null;
    if (!status) continue;
    out.push(line("clock", `c${c.id}:${status}`, `${c.label} ${status}${status === "stopped" && c.expired ? " · time ran out" : ""}`));
  }
  if (next.progress.unitsDone > prev.progress.unitsDone) {
    out.push(line("unit-closed", `u${next.progress.unitsDone}`, `${next.words.unit} ${prev.unit} closed · ${next.progress.unitsDone} ${next.progress.unitsDone === 1 ? next.words.unit.toLowerCase() : next.words.units.toLowerCase()} done`));
  }
  if (next.status === "ended" && prev.status !== "ended") {
    out.push(line("run-ended", "end", next.ending ? `${next.ending}` : `The ${next.words.run.toLowerCase()} is over`));
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A gesture as a line, or null for a kind the ticker does not show. */
export function lineOfGesture(g: Pick<Gesture, "kind" | "data" | "from" | "at">): TickerLine | null {
  const d = g.data;
  switch (g.kind) {
    case "rolled": {
      const total = num(d["total"]);
      if (total === null) return null;
      const what = str(d["label"]) ?? str(d["notation"]);
      return line("rolled", `g${g.at}`, `${g.from ? `${g.from} rolled` : "Rolled"} ${total}${what ? ` on ${what}` : ""}`);
    }
    case "outcome": {
      const n = num(d["n"]);
      const text = str(d["text"]);
      if (n === null || !text) return null;
      const subject = str(d["subject"]);
      return line("outcome", `o${n}`, subject ? `${text} → ${subject}` : text);
    }
    case "award": {
      const who = str(d["contestant"]);
      const points = num(d["points"]);
      if (!who || points === null) return null;
      const text = str(d["text"]);
      return line("award", `w${g.at}`, `${who} +${points}${text ? ` · ${text}` : ""}`);
    }
    case "clock": {
      const label = str(d["label"]);
      const status = str(d["status"]);
      const id = str(d["clock"]);
      if (!label || !status || !id) return null;
      return line("clock", `c${id}:${status}`, `${label} ${status}${status === "stopped" && d["expired"] === true ? " · time ran out" : ""}`);
    }
    case "unit-closed": {
      const done = num(d["unitsDone"]);
      const unit = num(d["unit"]);
      if (done === null) return null;
      return line("unit-closed", `u${done}`, `${unit !== null ? `Unit ${unit} closed · ` : ""}${done} done`);
    }
    case "run-ended":
      return line("run-ended", "end", str(d["ending"]) ?? "Over");
    default:
      return null;
  }
}

export const TICKER_LINES = 6;

/**
 * The lines to show, newest first, from the snapshots as they change and
 * the gestures as they arrive; never more than `max`, never the same
 * line twice.
 */
export function useTicker(snapshot: LiveSnapshot | null, gesture: Gesture | null, max: number = TICKER_LINES): TickerLine[] {
  const [lines, setLines] = useState<TickerLine[]>([]);
  const prev = useRef<LiveSnapshot | null>(null);
  const add = (fresh: TickerLine[]) => {
    if (fresh.length === 0) return;
    setLines((have) => {
      const known = new Set(have.map((l) => l.id));
      const added = fresh.filter((l) => !known.has(l.id));
      return added.length === 0 ? have : [...added.reverse(), ...have].slice(0, max);
    });
  };
  useEffect(() => {
    if (!snapshot) return;
    add(tickerLines(prev.current, snapshot));
    prev.current = snapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);
  useEffect(() => {
    if (!gesture) return;
    const l = lineOfGesture(gesture);
    if (l) add([l]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture]);
  return lines;
}
