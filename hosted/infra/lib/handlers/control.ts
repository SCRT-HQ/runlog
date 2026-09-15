/**
 * Turning what the dice said into what a tool should do.
 *
 * A run draws a result. Something attached to the player's game can make
 * that result real: a status effect, a restriction, a place to be moved
 * to. The translation between the two is here, on this side, for one
 * reason above all others: a mapping somebody got wrong should be fixable
 * in an afternoon, and a mapping that lives in a downloaded executable is
 * not.
 *
 * So the tool knows how to perform named operations and nothing else, and
 * this knows which operation a result means and nothing about how it is
 * performed. Neither needs the other's release cycle.
 *
 * The mapping itself is a **control profile**: rows keyed by the table and
 * entry a result landed on, or by a tag the entry carries, each naming
 * operations and who they reach. It is not part of a pack. A pack that
 * only worked with one Windows program attached to one game would not be
 * a pack, and every pack here still plays with nothing attached at all.
 */

/** One operation, as the tool's own vocabulary names it. */
export interface ControlOp {
  op: string;
  args?: Record<string, unknown>;
  /**
   * Given once in a run, rather than every time a tool attaches.
   *
   * The terms are sent on every attach because a tool that restarted is
   * holding none of them: its restore log puts prior values back, it does
   * not re-apply. That is right for a setting and wrong for a gift. A
   * run whose terms hand over fifty thousand runes handed them over again
   * on every reconnect, which is a different game by the third one.
   *
   * So an operation that cannot be taken back says so, and the run
   * remembers who has had it.
   */
  once?: boolean;
  /**
   * Came from the loadout this run is played under, not from the pack's
   * own terms.
   *
   * They travel as one list because a tool applies them the same way and
   * because the alternative is a second field in every snapshot. They go
   * out as two effects because handing the loadout out again is a button
   * somebody presses, and a tool re-applying an id takes the old one off
   * first: one list would mean that button reverted the run's terms and
   * put them back, which is at best a flicker and at worst a setting
   * that came back wrong.
   */
  chosen?: boolean;
}

/**
 * One mapping: what to do when a result lands, and who it reaches.
 *
 * A row selects by entry (with its table, where two tables share an entry
 * id), by tag, or by table. A row that selects nothing is ignored rather
 * than treated as "everything", because the cost of those two mistakes is
 * not remotely the same.
 */
export interface ControlRow {
  table?: string;
  entry?: string;
  tag?: string;
  label?: string;
  /** Seconds it lasts. Absent means until something takes it back. */
  for?: number;
  /**
   * The other way to say how long: until the unit it landed in closes.
   *
   * Which is what these games actually mean. A curse drawn for a Region
   * lasts that Region, and a pack forced to say so in seconds would be
   * guessing at how long a Region takes, and would be wrong.
   */
  until?: "unit";
  /** A seat's name, or absent for everyone at the table. */
  to?: string;
  ops: ControlOp[];
}

export interface ControlProfile {
  /**
   * The tool this was written for, as that tool names itself.
   *
   * Operation names are the compatibility story between versions of one
   * program, and say nothing between programs: two tools for two games
   * could easily both have a `warp.position`, and a profile meant for one
   * of them matching a table id in the other would move somebody for no
   * reason at all. So a profile says who it is for, and anything else
   * listening is sent nothing.
   */
  tool?: string;
  /** Applied when a tool attaches, and held for the run. */
  setup?: ControlOp[];
  rows?: ControlRow[];
}

/** The id every attached tool knows its setup by, so the run can take it back. */
export const SETUP_ID = "setup";

/** And the loadout, which is chosen per run and handed out on its own. */
export const LOADOUT_ID = "loadout";

/** Reverting this id takes back everything, whatever it was. */
export const EVERYTHING = "*";

/**
 * The bounds a profile is held to.
 *
 * A profile is one document and may be long: a table of a hundred
 * destinations wants a row each, and capping the document would silently
 * drop the second half of somebody's work. What actually needs a limit
 * is how much one result can set off, which is `MOST_AT_ONCE` below:
 * that is the number a runaway profile would use to flood a socket.
 */
const MOST_ROWS = 250;
const MOST_OPS = 20;
const MOST_AT_ONCE = 10;
const LONGEST = 3600;

/**
 * The profile the run is carrying, read defensively.
 *
 * It arrives inside a snapshot written by somebody's browser, so nothing
 * here trusts its shape: anything that is not what it claims to be is
 * dropped rather than repaired, and a profile that ends up empty simply
 * means nothing happens, which is the right failure for this.
 */
export function profileOf(snapshot: unknown): ControlProfile | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const control = (snapshot as Record<string, unknown>)["control"];
  if (!control || typeof control !== "object") return null;
  const raw = control as Record<string, unknown>;
  const setup = opsOf(raw["setup"]);
  const rows = Array.isArray(raw["rows"])
    ? raw["rows"]
        .slice(0, MOST_ROWS)
        .map(rowOf)
        .filter((r): r is ControlRow => r !== null)
    : [];
  if (setup.length === 0 && rows.length === 0) return null;
  const tool = typeof raw["tool"] === "string" && raw["tool"].length > 0 && raw["tool"].length <= 64 ? raw["tool"] : undefined;
  return { ...(tool ? { tool } : {}), setup, rows };
}

function opsOf(value: unknown): ControlOp[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MOST_OPS)
    .map((entry): ControlOp | null => {
      if (!entry || typeof entry !== "object") return null;
      const op = (entry as Record<string, unknown>)["op"];
      if (typeof op !== "string" || op.length === 0 || op.length > 64) return null;
      const args = (entry as Record<string, unknown>)["args"];
      // `once` survives the trip: it is what stops a gift in the terms
      // being handed over again on every reconnect, and a field dropped
      // here would be a field the run silently ignores.
      const once = (entry as Record<string, unknown>)["once"] === true;
      // And so does `chosen`, which decides which of the two effects an
      // operation goes out in. Dropped here, the whole loadout would
      // read as the pack's terms and the button would hand out both.
      const chosen = (entry as Record<string, unknown>)["chosen"] === true;
      return {
        op,
        args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        ...(once ? { once: true } : {}),
        ...(chosen ? { chosen: true } : {}),
      };
    })
    .filter((o): o is ControlOp => o !== null);
}

function rowOf(value: unknown): ControlRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ops = opsOf(raw["ops"]);
  if (ops.length === 0) return null;
  const text = (name: string) => (typeof raw[name] === "string" && (raw[name] as string).length <= 200 ? (raw[name] as string) : undefined);
  const seconds =
    typeof raw["for"] === "number" && Number.isFinite(raw["for"])
      ? Math.max(1, Math.min(LONGEST, Math.floor(raw["for"] as number)))
      : undefined;
  const row: ControlRow = { ops };
  const table = text("table");
  const entry = text("entry");
  const tag = text("tag");
  const label = text("label");
  const to = text("to");
  if (table !== undefined) row.table = table;
  if (entry !== undefined) row.entry = entry;
  if (tag !== undefined) row.tag = tag;
  if (label !== undefined) row.label = label;
  if (to !== undefined) row.to = to;
  if (seconds !== undefined) row.for = seconds;
  // Seconds win where a row somehow says both, since a number is the
  // more deliberate thing to have written down.
  if (seconds === undefined && raw["until"] === "unit") row.until = "unit";
  // A row that names nothing to match would otherwise fire on every
  // result in the run.
  if (row.table === undefined && row.entry === undefined && row.tag === undefined) return null;
  return row;
}

/** What a result said it was, in the fields a row matches on. */
export interface Landed {
  n?: number;
  unit?: number;
  tableId?: string;
  entryId?: string;
  tags?: string[];
  text?: string;
}

export function landedOf(data: unknown): Landed | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  // Without ids there is nothing to match on. Matching the words instead
  // would break the first time an author fixed a typo, which is exactly
  // why the ids are on the wire.
  if (typeof raw["entryId"] !== "string" && typeof raw["tableId"] !== "string") return null;
  const landed: Landed = {};
  if (typeof raw["n"] === "number") landed.n = raw["n"];
  if (typeof raw["unit"] === "number") landed.unit = raw["unit"];
  if (typeof raw["tableId"] === "string") landed.tableId = raw["tableId"];
  if (typeof raw["entryId"] === "string") landed.entryId = raw["entryId"];
  if (typeof raw["text"] === "string") landed.text = raw["text"];
  if (Array.isArray(raw["tags"])) landed.tags = raw["tags"].filter((t): t is string => typeof t === "string");
  return landed;
}

function matches(row: ControlRow, landed: Landed): boolean {
  if (row.entry !== undefined) {
    if (row.entry !== landed.entryId) return false;
    return row.table === undefined || row.table === landed.tableId;
  }

  if (row.tag !== undefined) return (landed.tags ?? []).includes(row.tag);
  return row.table !== undefined && row.table === landed.tableId;
}

/**
 * Whether an effect meant for a named seat reaches this one.
 *
 * A row with no seat reaches everyone, which is what the moderated packs
 * want: one curse, every runner. A tool that never said which player it
 * is hears only those.
 */
function reaches(row: ControlRow, seat: string | undefined): boolean {
  if (row.to === undefined || row.to.toLowerCase() === "all") return true;
  if (!seat) return false;
  return row.to.toLowerCase() === seat.toLowerCase();
}

/**
 * The frames one result produces for one attached tool.
 *
 * Every matching row makes its own frame, so a tag row covering eleven
 * curses and an entry row for the twelfth both land without either
 * knowing about the other. The id is the result's number and the row it
 * matched, which makes it stable: the same result sent twice, after a
 * reconnection say, is the same effect rather than a second one, and the
 * tool takes the first off before applying it again.
 */
export function appliesFor(profile: ControlProfile, landed: Landed, seat: string | undefined): string[] {
  const out: string[] = [];
  (profile.rows ?? []).forEach((row, index) => {
    if (out.length >= MOST_AT_ONCE) return;
    if (!matches(row, landed) || !reaches(row, seat)) return;
    out.push(
      JSON.stringify({
        t: "apply",
        id: `o${landed.n ?? 0}#${index}`,
        ...(row.label ? { label: row.label } : landed.text ? { label: landed.text } : {}),
        ...(row.for ? { for: row.for } : {}),
        // Everything a unit applied comes off together when it closes,
        // so the tool holds a group rather than a rule about units, and
        // this end says when.
        ...(row.until === "unit" && typeof landed.unit === "number" ? { group: groupOf(landed.unit) } : {}),
        ops: row.ops.map((o) => ({ op: o.op, args: o.args ?? {} })),
      }),
    );
  });
  return out;
}

/**
 * The run's terms, for a tool that has just attached.
 *
 * The pack's own, without the loadout: those are `loadoutFor` below, and
 * they are a separate effect under a separate id so that handing one out
 * mid-run does not disturb the other.
 *
 * `had` is whether this seat has already been given the parts that are
 * given once. Everything else goes every time, because a tool that
 * restarted is holding none of it and a setting reapplied is the same
 * setting. A gift reapplied is a second gift.
 *
 * Answers what to send and whether anything in it was a once, so the
 * caller knows there is something to remember.
 */
export function setupFor(profile: ControlProfile, had = false): { frame: string; gave: boolean } | null {
  return frameOf(
    (profile.setup ?? []).filter((o) => !o.chosen),
    SETUP_ID,
    "The run's terms",
    had,
  );
}

/**
 * The loadout the run is played under, for the same tool.
 *
 * Its own effect, because it is the one part of the setup with a button
 * that re-sends it. A tool applying an id it already holds takes the old
 * one off first, so a single effect carrying both would mean pressing
 * Hand it out reverted the pack's terms and re-applied them, and the
 * gifts among them, which is the thing the whole `once` record exists to
 * stop.
 */
export function loadoutFor(profile: ControlProfile, had = false): { frame: string; gave: boolean } | null {
  return frameOf(
    (profile.setup ?? []).filter((o) => o.chosen === true),
    LOADOUT_ID,
    "The run's loadout",
    had,
  );
}

/**
 * One setup file's operations, handed over once and nothing more.
 *
 * A warp, a gift, a switch thrown for a moment: the press says do this
 * now, not this is what the run is played under from here. So the
 * operations travel with the press rather than being read off the run,
 * and the run's own setup is neither rebuilt nor written to. The id and
 * the title are the setup file's own, which is what a tool writes in its
 * log, and they are also what a later revert would name.
 *
 * Nothing is held back: `had` is false because there is no record of who
 * has had this and no intention of keeping one. A gift sent twice was
 * sent twice on purpose, by somebody pressing the key twice.
 */
export function commandFor(ops: ControlOp[], id: string, title: string): { frame: string; gave: boolean } | null {
  return frameOf(ops, id, title, false);
}

function frameOf(all: ControlOp[], id: string, label: string, had: boolean): { frame: string; gave: boolean } | null {
  const ops = all.filter((o) => !(o.once && had));
  if (ops.length === 0) return null;
  const gave = ops.some((o) => o.once === true);
  const frame = JSON.stringify({
    t: "apply",
    id,
    label,
    // A list of separate things, not one effect. A rule's operations
    // stand or fall together, because a rule that makes somebody slow
    // and blind is one rule and half of it is a different one nobody
    // wrote. Terms are eight settings and gifts, and a ninth written
    // against a newer build than the one attached should not cost
    // somebody the other eight.
    each: true,
    ops: ops.map((o) => ({ op: o.op, args: o.args ?? {} })),
  });
  return { frame, gave };
}

/** Take back one effect, or with the reserved id, all of them. */
export function revert(id: string): string {
  return JSON.stringify({ t: "revert", id });
}

/** What an effect that lasts a unit is filed under. */
export function groupOf(unit: number): string {
  return `unit:${unit}`;
}

/** Take back everything applied under one group. */
export function revertGroup(group: string): string {
  return JSON.stringify({ t: "revert", group });
}

/**
 * Whether a profile is talking to this program at all.
 *
 * A profile naming no tool is for whatever is listening, which is how
 * somebody's own script works with no ceremony. One that names a tool is
 * for that tool, and a connection that never said what it is does not get
 * the benefit of the doubt.
 */
export function fits(profile: ControlProfile, app: string | undefined): boolean {
  if (!profile.tool) return true;
  return app !== undefined && profile.tool.toLowerCase() === app.toLowerCase();
}

/**
 * What an attached tool should be told about a gesture that is not a
 * result: a run ending takes everything off, since nothing a run applied
 * should outlive it.
 */
export function framesForGesture(profile: ControlProfile, kind: string, data: unknown, seat: string | undefined): string[] {
  if (kind === "run-ended") return [revert(EVERYTHING)];
  if (kind === "unit-closed") {
    const unit = data && typeof data === "object" ? (data as Record<string, unknown>)["unit"] : undefined;
    return typeof unit === "number" ? [revertGroup(groupOf(unit))] : [];
  }

  // A result taken back takes its effects with it. Every rule that
  // matched filed its effect under the result's own number, so the
  // number is enough to name all of them at once without working out
  // again which rules matched what.
  if (kind === "outcome-undone") {
    const n = data && typeof data === "object" ? (data as Record<string, unknown>)["n"] : undefined;
    return typeof n === "number" ? [revert(`o${n}#${EVERYTHING}`)] : [];
  }

  if (kind !== "outcome") return [];
  const landed = landedOf(data);
  if (!landed) return [];
  // A result drawn for one racer reaches that racer's game and no
  // other, whatever the rules say about who they reach. A boon Nate
  // earned is not half damage on four machines, and a connection that
  // never said which seat it is cannot be the one that gets it.
  const only = data && typeof data === "object" ? (data as Record<string, unknown>)["seat"] : undefined;
  if (typeof only === "string" && only.length > 0) {
    if (!seat || seat.toLowerCase() !== only.toLowerCase()) return [];
  }
  return appliesFor(profile, landed, seat);
}

/**
 * What a tool may say happened in the game, and what a run does about it.
 *
 * The tool reports on the socket it already holds rather than fetching a
 * URL of ours, which is the difference between a protocol and an
 * integration: a tool that says `died` is saying something true about the
 * game, and what that means is the listener's business. Here it means an
 * ask, which is the same thing a viewer pressing a button raises, and
 * which the table still has to accept.
 *
 * Deliberately a short list. A kind nobody here knows is ignored, so a
 * later tool saying more than this does not break against an older
 * server.
 */
const MEANS: Record<string, { move: string }> = {
  died: { move: "died" },
  // A watch the run put on has fired: the boss the objective named is
  // dead, or the thing it named is in the player's hands. The same shape
  // as a death, and the same rule about who accepts it.
  settled: { move: "settled" },
};

export function askFor(kind: string): { move: string } | null {
  if (typeof kind !== "string") return null;
  return MEANS[kind] ?? null;
}
