import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "./events.ts";
import { effectiveEvents } from "./log.ts";
import { reduce } from "./reduce.ts";
import type { RunState } from "./types.ts";

/**
 * Taking a run out of the app.
 *
 * Two shapes, because they answer two different questions. The archive is the
 * event log itself: it round-trips exactly, which is what makes it worth
 * trusting as a backup and as the thing you hand to the next version of this
 * app. The write-up is for a person — the Run Log sheet, filled in.
 *
 * Neither is allowed to launder a rulebook. A pack marked non-redistributable
 * is a private transcription of something its author sells, and its text does
 * not travel: the archive never carries rules text at all, and the write-up
 * withholds it whenever the export is meant for somebody else. That rule lives
 * here rather than in the view, so no button can be added later that quietly
 * skips it.
 */

export const RUN_FORMAT = "runlog.run";
export const RUN_FORMAT_VERSION = 1;

export interface RunArchive {
  format: typeof RUN_FORMAT;
  formatVersion: number;
  /** Enough to find the pack again. Identification, not content. */
  pack: { id: string; version: string; title: string };
  /** The run's own name, when the log carried one. */
  runId?: string;
  /** What the player called it, when they did. */
  name?: string;
  /**
   * Who the copy of the pack was issued to, when it was a sold copy.
   *
   * Carried so a log that travels says which copy produced it. This is the
   * whole point of a watermark: it has to survive leaving the app.
   */
  issuedTo?: string;
  mode: string;
  seed: string | null;
  startedAt: string;
  endedAt: string | null;
  exportedAt: string;
  events: RunEvent[];
}

/** Who the export is for. A run kept for yourself may quote what you own. */
export type Audience = "self" | "share";

/**
 * Whether this pack's text may travel.
 *
 * `redistributable: false` is the pack author saying the words are theirs.
 * Personal use is what the license allows, so an export the player keeps may
 * carry the text; one addressed to anyone else may not.
 */
export function mayQuote(pack: Pack, audience: Audience): boolean {
  return audience === "self" || pack.license.redistributable !== false;
}

export function exportRun(pack: Pack, events: RunEvent[], now = new Date().toISOString()): RunArchive {
  const state = reduce(pack, events);
  const first = events[0];
  const runId = first?.t === "RunStarted" ? first.runId : undefined;
  return {
    format: RUN_FORMAT,
    formatVersion: RUN_FORMAT_VERSION,
    pack: { id: pack.id, version: pack.version, title: pack.title },
    ...(runId ? { runId } : {}),
    ...(state.name ? { name: state.name } : {}),
    ...(pack.issue?.to ? { issuedTo: pack.issue.to } : {}),
    mode: state.mode,
    seed: state.seed,
    startedAt: state.startedAt,
    endedAt: state.status === "ended" ? state.updatedAt : null,
    exportedAt: now,
    events,
  };
}

export type ImportResult =
  | { ok: true; archive: RunArchive }
  | { ok: false; error: string };

/**
 * Read an archive back.
 *
 * Deliberately strict about the envelope and entirely trusting of the events
 * inside it, because the reducer is the thing that knows what an event is —
 * and it will throw on a log that does not begin properly. Checking the shape
 * twice would only mean two places to keep in step.
 */
export function importRun(raw: unknown): ImportResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "not a run archive" };
  const a = raw as Partial<RunArchive>;

  if (a.format !== RUN_FORMAT) return { ok: false, error: "not a run archive" };
  if (typeof a.formatVersion !== "number" || a.formatVersion > RUN_FORMAT_VERSION) {
    return { ok: false, error: `this run was saved by a newer version (format ${String(a.formatVersion)})` };
  }
  if (!a.pack?.id) return { ok: false, error: "the archive does not say which pack it was played with" };
  if (!Array.isArray(a.events) || a.events.length === 0) {
    return { ok: false, error: "the archive contains no events" };
  }
  if ((a.events[0] as RunEvent | undefined)?.t !== "RunStarted") {
    return { ok: false, error: "the log does not begin with the start of a run" };
  }
  return { ok: true, archive: a as RunArchive };
}

/* ------------------------------------------------------------------ *
 * The write-up
 * ------------------------------------------------------------------ */

/** A short, human date. Runs can span days, so the day is worth saying. */
function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf()) ? iso : d.toISOString().slice(0, 10);
}

function tableTitle(pack: Pack, id: string): string {
  return pack.tables[id]?.title ?? id;
}

function entryText(pack: Pack, table: string, entryId: string, quote: boolean): string {
  if (!quote) return `\`${entryId}\``;
  const entry = pack.tables[table]?.entries.find((e) => e.id === entryId);
  if (!entry) return `\`${entryId}\``;
  const text = entry.text.replace(/\s+/g, " ").trim();
  return entry.title ? `**${entry.title}.** ${text}` : text;
}

function stateLabel(pack: Pack, id: string): string {
  return pack.states?.[id]?.label ?? id;
}

/**
 * How a subject is referred to mid-log.
 *
 * By number and by what it was declared to be, but *without* its states —
 * those change as the run goes on, and a line describing what happened in
 * unit two should not be re-labeled by something that happened in unit five.
 */
function ref(pack: Pack, state: RunState, id: number): string {
  const subject = state.subjects.find((s) => s.id === id);
  const base = `${pack.vocabulary.subject.one} ${id}`;
  return subject?.type ? `${base} (${subject.type})` : base;
}

/**
 * Render the run as the log sheet a player would otherwise keep by hand.
 *
 * Built from the events rather than from derived state so the order is the
 * order things actually happened in — a log that reorders itself into tidy
 * categories stops being a record of the session.
 */
export function renderLog(
  pack: Pack,
  events: RunEvent[],
  { audience = "self" }: { audience?: Audience } = {},
): string {
  const state = reduce(pack, events);
  const v = pack.vocabulary;
  const quote = mayQuote(pack, audience);
  const out: string[] = [];

  out.push(`# ${pack.title} — ${v.run.one}`);
  out.push("");

  const mode = pack.modes[state.mode]?.label ?? state.mode;
  const meta = [mode];
  if (state.seed) meta.push(`seed \`${state.seed}\``);
  if (state.players > 1) meta.push(`${state.players} players`);
  meta.push(`${state.unit} ${(state.unit === 1 ? v.unit.one : v.unit.many).toLowerCase()}`);
  meta.push(day(state.startedAt));
  out.push(`*${meta.join(" · ")}*`);
  out.push("");

  // A watermark that does not survive being written up is not a watermark.
  // Said plainly rather than hidden in the file: the buyer was told their copy
  // carries their name, so a log that carries it too is not a surprise.
  if (pack.issue?.to) {
    out.push(`*Played from a copy issued to ${pack.issue.to}.*`);
    out.push("");
  }

  if (!quote) {
    out.push(
      `> Rules text withheld: **${pack.title}** is not redistributable, so this copy records ` +
        `which results came up, not what they say. Export it for yourself to read the text.`,
    );
    out.push("");
  }

  /** Rolls wait here until the outcome they produced arrives. */
  const rolls = new Map<string, { total: number; dice: string; source: string }>();
  let unit = 0;
  let open = false;

  /** A blank line, unless the last one already was. */
  const gap = () => {
    if (out.at(-1) !== "") out.push("");
  };

  /**
   * Anything that happens before the first unit — an opening hand, a run-wide
   * state dealt at the start — needs somewhere to live, or it reads as a stray
   * line under the title with nothing to attach it to.
   */
  const opening = () => {
    if (unit > 0 || open) return;
    gap();
    out.push(`## Before ${v.unit.one} 1`);
    out.push("");
    open = true;
  };

  /**
   * Write one line of the body.
   *
   * Everything the loop emits goes through here, which is what guarantees a
   * line can never appear above the first heading: an event that prints
   * nothing opens nothing.
   */
  const line = (text: string) => {
    opening();
    out.push(text);
  };

  const heading = (n: number) => {
    const subject = state.subjects.findLast((s) => s.unit === n);
    const named = subject?.type ? ` — ${subject.type}` : "";
    gap();
    out.push(`## ${v.unit.one} ${n}${named}`);
    out.push("");
  };

  for (const e of effectiveEvents(events)) {
    switch (e.t) {
      case "UnitEntered":
        unit += 1;
        heading(unit);
        break;

      case "Rolled":
        rolls.set(e.purpose, { total: e.total, dice: e.dice, source: e.source });
        break;

      case "OutcomeResolved": {
        const roll = rolls.get(e.table);
        rolls.delete(e.table);
        const shown = roll ? ` (${roll.dice} → ${roll.total}${roll.source === "physical" ? "" : `, ${roll.source}`})` : "";
        const target =
          e.targetSubject !== undefined
            ? ` → ${ref(pack, state, e.targetSubject)}`
            : "";
        line(
          `- **${tableTitle(pack, e.table)}**${shown}${target} — ${entryText(pack, e.table, e.entryId, quote)}`,
        );
        break;
      }

      case "StateApplied":
        line(
          `- ${stateLabel(pack, e.state)}${e.subject ? ` on ${ref(pack, state, e.subject)}` : " (run-wide)"}`,
        );
        break;

      case "SubjectRemoved":
        line(`- ${ref(pack, state, e.subject)} removed from play`);
        break;

      case "TypeBanned":
        line(`- \`${e.subjectType}\` may no longer be declared`);
        break;

      case "UnitForced":
        line(`- ${e.count} more ${v.unit.many.toLowerCase()} forced`);
        break;

      case "ExtraRollQueued": {
        const title = pack.tables[e.table]?.title ?? e.table;
        line(`- ${e.count} more ${title} roll${e.count === 1 ? "" : "s"} ${e.unit === "next" ? `next ${v.unit.one.toLowerCase()}` : `this ${v.unit.one.toLowerCase()}`}`);
        break;
      }

      case "ExtraRollTaken":
        line(`- an extra ${pack.tables[e.table]?.title ?? e.table} roll, as owed`);
        break;

      case "RewindQueued":
        line(`- sent back ${e.count} ${(e.count === 1 ? v.unit.one : v.unit.many).toLowerCase()} at the close of this one`);
        break;

      case "CardPlayed":
      case "CardDrawn": {
        const deck = pack.decks?.[e.deck];
        const card =
          deck?.kind === "cards" ? deck.cards.find((c) => c.id === e.cardId) : undefined;
        const name = quote ? (card?.title ?? e.cardId) : `\`${e.cardId}\``;
        line(`- ${e.t === "CardDrawn" ? "Drew" : "Played"} ${name}`);
        break;
      }

      case "JournalWritten":
        opening();
        gap();
        out.push(`> ${e.text.replace(/\n+/g, " ")}`);
        break;

      // Bookkeeping the reader does not need; the board at the end says where
      // it all landed.
      default:
        break;
    }
  }

  if (unit === 0) {
    gap();
    out.push(`*No ${v.unit.many.toLowerCase()} were entered.*`);
  }

  /* ---- how it finished ------------------------------------------------ */

  gap();
  if (state.ending) {
    const ending = pack.endings?.find((x) => x.id === state.ending);
    out.push(`## ${ending?.label ?? state.ending}`);
    out.push("");
    if (ending?.text && quote) out.push(ending.text.replace(/\s+/g, " ").trim());
  } else {
    out.push(`## Still going`);
    out.push("");
    out.push(`This ${v.run.one.toLowerCase()} has not been declared over.`);
  }

  const surviving = state.subjects.filter((s) => !s.removed);
  out.push("");
  out.push(`### The board`);
  out.push("");
  if (surviving.length === 0) {
    out.push(`Nothing survived.`);
  } else {
    for (const s of surviving) {
      const states = s.states.map((id) => stateLabel(pack, id)).join(", ");
      out.push(
        `- ${pack.vocabulary.subject.one} ${s.id}: ${s.type ?? "undeclared"}${states ? ` — ${states}` : ""}`,
      );
    }
  }

  const tallies = [
    ...Object.entries(state.counters).map(([id, n]) => `${pack.counters?.[id]?.label ?? id} ${n}`),
    ...Object.entries(state.resources).map(([id, n]) => `${pack.resources?.[id]?.label ?? id} ${n}`),
  ];
  if (tallies.length > 0) {
    out.push("");
    out.push(tallies.join(" · "));
  }

  out.push("");
  out.push(`---`);
  out.push("");
  out.push(`*${pack.title} v${pack.version}${pack.author ? ` by ${pack.author}` : ""} — logged with Runlog.*`);
  out.push("");

  return out.join("\n");
}

/**
 * A filename that sorts and says what it is.
 *
 * The date first, because a folder of these is read chronologically.
 */
export function logFilename(pack: Pack, state: RunState, ext: "json" | "md"): string {
  const slug = pack.id.split(".").pop() ?? "run";
  return `${day(state.startedAt)}-${slug}-${state.mode}.${ext}`;
}
