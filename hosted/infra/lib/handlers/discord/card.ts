import { challenges, constrainedByOf, constraintsFor, entryTextOf, formatClock, elapsedMs, liveClocks, moderation, standings, subjectName, type Agenda, type Pending, type RunEvent, type RunState } from "@runlog/engine";
import type { Pack } from "@runlog/rules-schema";
import type { GuildRun } from "../guilds.js";
import { REACTIONS } from "./reactions.js";
import { button, ButtonStyle, row, select, type Embed } from "./types.js";

/**
 * The table card: one message, pinned in the run's thread, that says where
 * the run stands and carries the one press that is due. Rebuilt from the
 * log after every move and edited in place, so whoever opens the thread
 * sees the table as it is, not a transcript of how it got there. The
 * transcript is the lines posted beneath it, one per move.
 *
 * What is on it is what the app's own screen shows: the unit and the step,
 * the constraints in play, the latest result, the trackers, the standings.
 * What is not on it is the pack: a drawn line is the run's, the table it
 * came from is not, so the card quotes results and never lists a table.
 */

export interface Card {
  embeds: Embed[];
  components: unknown[];
}

/** `rl:<runId>:<verb>[:<arg>]`, under Discord's hundred characters: a ULID is twenty-six. */
export const customId = (runId: string, verb: string, arg?: string) => `rl:${runId}:${verb}${arg !== undefined ? `:${arg}` : ""}`;

export function parseCustomId(raw: string): { runId: string; verb: string; arg?: string } | null {
  const m = /^rl:([A-Za-z0-9_-]+):([a-z-]+)(?::(.*))?$/.exec(raw);
  return m ? { runId: m[1]!, verb: m[2]!, ...(m[3] !== undefined ? { arg: m[3] } : {}) } : null;
}

const MAX_FIELD = 1024;
const clip = (s: string, n = MAX_FIELD) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function cardFor(input: { pack: Pack; state: RunState; events: readonly RunEvent[]; agenda: Agenda; run: GuildRun; pending?: Pending }): Card {
  const { pack, state, agenda, run, pending } = input;
  const v = pack.vocabulary;
  const id = run.sessionId;
  const mode = pack.modes[state.mode];
  const moderated = Boolean(moderation(pack, state));
  const ending = state.ending ? (pack.endings?.find((e) => e.id === state.ending)?.label ?? state.ending) : null;
  const active = agenda.active;
  const stepLabel = active ? ("label" in active.step && active.step.label ? active.step.label : active.step.kind === "rollTable" ? (pack.tables[active.step.table]?.title ?? active.step.table) : active.phase.label) : null;

  const embed: Embed = {
    title: `${state.name ?? pack.title} · ${mode?.label ?? state.mode}`,
    description:
      state.status === "ended"
        ? `Ended · ${ending ?? "finished"}`
        : state.unit === 0
          ? `Not begun. ${run.hostName} begins the first ${v.unit.one.toLowerCase()}.`
          : `${v.unit.one} ${state.unit}${active ? ` · ${active.phase.label} · ${stepLabel}` : ` · between ${v.unit.many.toLowerCase()}`}`,
    fields: [],
    footer: { text: `Hosted by ${run.hostName} · Runlog` },
  };
  const fields = embed.fields!;

  if (pending) {
    const r = pending.request;
    const what = r.kind === "roll" ? `Roll ${r.dice}${r.label ? ` for ${r.label}` : ""}` : r.kind === "ask" ? r.question : r.label;
    fields.push({ name: "Waiting on", value: clip(what) });
  }
  const constraints = active ? constraintsFor(pack, state, constrainedByOf(active.step)) : [];
  if (constraints.length > 0) fields.push({ name: "The game has already had its say", value: clip(constraints.map((c) => `• ${c}`).join("\n")) });
  const latest = state.outcomes[state.outcomes.length - 1];
  if (latest) {
    const hit = latest.targetSubject !== null && latest.targetSubject !== undefined ? state.subjects.find((s) => s.id === latest.targetSubject) : undefined;
    fields.push({ name: "Latest", value: clip(`${entryTextOf(pack, latest)}${hit ? ` → ${subjectName(pack, hit)}` : ""}`) });
  }
  const trackers = [
    ...state.subjects.filter((s) => s.unit === state.unit || !s.finalized).slice(-6).map((s) => `${subjectName(pack, s)}${s.states.length > 0 ? ` [${s.states.map((st) => pack.states?.[st]?.short ?? pack.states?.[st]?.label ?? st).join(" ")}]` : ""}`),
    ...Object.entries(state.counters ?? {}).map(([cid, value]) => `${pack.counters?.[cid]?.label ?? cid}: ${value}`),
    ...Object.entries(state.resources ?? {}).map(([rid, value]) => `${pack.resources?.[rid]?.label ?? rid}: ${value}${pack.resources?.[rid]?.max !== undefined ? ` / ${pack.resources[rid]!.max}` : ""}`),
  ];
  if (trackers.length > 0) fields.push({ name: "On the table", value: clip(trackers.join("\n")), inline: true });
  const now = Date.now();
  const clocks = liveClocks(state).map((c) => `${c.label}: ${formatClock(c.seconds === null ? elapsedMs(c, now) : Math.max(0, c.seconds * 1000 - elapsedMs(c, now)))}${c.status === "paused" ? " (paused)" : ""}`);
  if (clocks.length > 0) fields.push({ name: "Clocks", value: clip(clocks.join("\n")), inline: true });
  if (moderated) {
    const board = standings(state);
    fields.push({ name: "Standings", value: board.length === 0 ? "Nobody on the roster yet. Press Join." : clip(board.map((s) => `#${s.place} ${s.contestant.name} · ${s.points}`).join("\n")) });
  }

  return { embeds: [embed], components: componentsFor(id, pack, state, agenda, run, pending) };
}

function componentsFor(id: string, pack: Pack, state: RunState, agenda: Agenda, run: GuildRun, pending?: Pending): unknown[] {
  const rows: unknown[] = [];
  const v = pack.vocabulary;
  if (state.status === "ended") return rows;

  if (pending) {
    const r = pending.request;
    if (r.kind === "roll") rows.push(row(button(customId(id, "roll"), `Roll ${r.dice}`, ButtonStyle.Primary)));
    else if (r.kind === "ask" || (r.kind === "prompt" && r.promptKind === "confirm")) rows.push(row(button(customId(id, "yes"), "Yes", ButtonStyle.Success), button(customId(id, "no"), "No", ButtonStyle.Danger)));
    else if (r.kind === "chooseTarget") {
      const eligible = state.subjects.filter((s) => r.eligible.includes(s.id));
      rows.push(select(customId(id, "target"), r.label, eligible.map((s) => ({ label: subjectName(pack, s), value: String(s.id) }))));
    } else if (r.kind === "prompt" && r.promptKind === "text") rows.push(row(button(customId(id, "text"), "Answer…", ButtonStyle.Primary)));
    else if (r.kind === "prompt" && r.options && r.options.length > 0) rows.push(select(customId(id, "pick"), r.label, r.options.map((o, i) => ({ label: o, value: String(i) }))));
    else rows.push(row(button(customId(id, "text"), "Answer…", ButtonStyle.Primary)));
    return rows;
  }

  // The checklist comes first, and the press that closes the step waits on
  // it: the same order the app's step card keeps, and the driver refuses
  // a step whose boxes are not ticked anyway.
  const ticked = agenda.checklist.every((c) => c.on);
  if (agenda.checklist.length > 0) {
    rows.push(row(...agenda.checklist.slice(0, 5).map((c) => button(customId(id, "tick", String(c.index)), `${c.on ? "☑" : "☐"} ${c.text}`, c.on ? ButtonStyle.Success : ButtonStyle.Secondary))));
  }
  const main: unknown[] = [];
  if (agenda.phase === "setup" || agenda.phase === "betweenUnits") {
    main.push(button(customId(id, "enter"), `${state.unit === 0 ? "Begin" : "Next"} ${v.unit.one.toLowerCase()}`, ButtonStyle.Primary));
  } else if (agenda.active) {
    const step = agenda.active.step;
    if (step.kind === "rollTable") main.push(button(customId(id, "step"), `Roll: ${pack.tables[step.table]?.title ?? step.table}`, ButtonStyle.Primary));
    else if (step.kind === "declareSubject") main.push(button(customId(id, "declare"), `Declare the ${v.subject.one.toLowerCase()}…`, ButtonStyle.Primary));
    else if (step.kind === "finalizeUnit") main.push(button(customId(id, "finalize"), `Close the ${v.unit.one.toLowerCase()}`, ButtonStyle.Primary, !ticked || !agenda.canFinalize));
    else main.push(button(customId(id, "step"), step.kind === "manual" ? "Done" : "Continue", ButtonStyle.Primary, !ticked));
  }
  if (agenda.phase === "betweenUnits" || agenda.phase === "setup") {
    if (state.unit > 0) main.push(button(customId(id, "end"), `End the ${v.run.one.toLowerCase()}`, ButtonStyle.Secondary));
  }
  // The first live clock is on the card to pause and resume; a second is in the field above.
  const clock = liveClocks(state).find((c) => c.status === "running" || c.status === "paused");
  if (clock) main.push(button(customId(id, "clock", `${clock.status === "running" ? "pause" : "resume"}:${clock.id}`), clock.status === "running" ? `Pause ${clock.label}` : `Resume ${clock.label}`));
  if (state.unit > 0 && main.length < 5) main.push(button(customId(id, "undo"), "Undo"));
  if (main.length > 0) rows.push(row(...main));
  const extras: unknown[] = [
    ...agenda.moves.slice(0, 3).map((m) => button(customId(id, "move", m), pack.moves?.[m]?.label ?? m)),
    ...agenda.due.slice(0, 2).map((o) => button(customId(id, "settle", o.id), (o as { label?: string }).label ?? "Settle what is due", ButtonStyle.Primary)),
  ];
  if (extras.length > 0) rows.push(row(...extras));

  if (moderation(pack, state)) {
    rows.push(row(button(customId(id, "join"), "Join the roster", ButtonStyle.Success), button(customId(id, "leave"), "Leave")));
    const open = challenges(pack, state).filter((c) => c.open);
    const ch = open[open.length - 1];
    if (ch && state.contestants.length > 0 && rows.length < 5) {
      rows.push(select(customId(id, "award", String(ch.outcome)), `Award ${ch.points} pt: ${ch.text.slice(0, 80)}`, state.contestants.map((c) => ({ label: c.name, value: c.id }))));
    }
  }
  // A wave from anyone watching, where the card has a row to spare; the
  // same six the live page offers, and they land in the same place.
  if (rows.length < 5) rows.push(row(...REACTIONS.map((emoji) => button(customId(id, "react", emoji), emoji))));
  void run;
  return rows.slice(0, 5);
}

/** What just happened, for the line under the card: results in the pack's words, the dice as thrown. */
export function lineFor(pack: Pack, before: RunState, after: RunState, produced: readonly RunEvent[]): string | null {
  const parts: string[] = [];
  for (const e of produced) {
    if (e.t === "Rolled") parts.push(`🎲 ${e.dice}: **${e.total}**`);
    if (e.t === "UnitEntered") parts.push(`${pack.vocabulary.unit.one} ${after.unit} begins.`);
    if (e.t === "SubjectDeclared") parts.push(`Declared: ${e.subjectType}.`);
    if (e.t === "UnitFinalized") parts.push(`${pack.vocabulary.unit.one} ${before.unit} closed.`);
  }
  const fresh = after.outcomes.slice(before.outcomes.length);
  for (const o of fresh) {
    const hit = o.targetSubject !== null && o.targetSubject !== undefined ? after.subjects.find((s) => s.id === o.targetSubject) : undefined;
    parts.push(`${pack.tables[o.table]?.title ?? o.table}: ${entryTextOf(pack, o)}${hit ? ` → ${subjectName(pack, hit)}` : ""}`);
  }
  return parts.length > 0 ? parts.join("\n").slice(0, 1900) : null;
}
