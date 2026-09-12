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
  /** Seconds it lasts. Absent means until the run says otherwise. */
  for?: number;
  /** A seat's name, or absent for everyone at the table. */
  to?: string;
  ops: ControlOp[];
}

export interface ControlProfile {
  /** Applied when a tool attaches, and held for the run. */
  setup?: ControlOp[];
  rows?: ControlRow[];
}

/** The id every attached tool knows its setup by, so the run can take it back. */
export const SETUP_ID = "setup";

/** Reverting this id takes back everything, whatever it was. */
export const EVERYTHING = "*";

/** No profile, however broken, makes a run send more than this at once. */
const MOST_ROWS = 20;
const MOST_OPS = 20;
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
  const rows = Array.isArray(raw["rows"]) ? raw["rows"].slice(0, MOST_ROWS).map(rowOf).filter((r): r is ControlRow => r !== null) : [];
  if (setup.length === 0 && rows.length === 0) return null;
  return { setup, rows };
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
      return { op, args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {} };
    })
    .filter((o): o is ControlOp => o !== null);
}

function rowOf(value: unknown): ControlRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ops = opsOf(raw["ops"]);
  if (ops.length === 0) return null;
  const text = (name: string) => (typeof raw[name] === "string" && (raw[name] as string).length <= 200 ? (raw[name] as string) : undefined);
  const seconds = typeof raw["for"] === "number" && Number.isFinite(raw["for"]) ? Math.max(1, Math.min(LONGEST, Math.floor(raw["for"] as number))) : undefined;
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
  // A row that names nothing to match would otherwise fire on every
  // result in the run.
  if (row.table === undefined && row.entry === undefined && row.tag === undefined) return null;
  return row;
}

/** What a result said it was, in the fields a row matches on. */
export interface Landed {
  n?: number;
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
    if (!matches(row, landed) || !reaches(row, seat)) return;
    out.push(
      JSON.stringify({
        t: "apply",
        id: `o${landed.n ?? 0}#${index}`,
        ...(row.label ? { label: row.label } : landed.text ? { label: landed.text } : {}),
        ...(row.for ? { for: row.for } : {}),
        ops: row.ops.map((o) => ({ op: o.op, args: o.args ?? {} })),
      }),
    );
  });
  return out;
}

/** The run's terms, applied when a tool attaches and held until it ends. */
export function setupFor(profile: ControlProfile): string | null {
  if (!profile.setup || profile.setup.length === 0) return null;
  return JSON.stringify({
    t: "apply",
    id: SETUP_ID,
    label: "The run's terms",
    ops: profile.setup.map((o) => ({ op: o.op, args: o.args ?? {} })),
  });
}

/** Take back one effect, or with the reserved id, all of them. */
export function revert(id: string): string {
  return JSON.stringify({ t: "revert", id });
}

/**
 * What an attached tool should be told about a gesture that is not a
 * result: a run ending takes everything off, since nothing a run applied
 * should outlive it.
 */
export function framesForGesture(profile: ControlProfile, kind: string, data: unknown, seat: string | undefined): string[] {
  if (kind === "run-ended") return [revert(EVERYTHING)];
  if (kind !== "outcome") return [];
  const landed = landedOf(data);
  if (!landed) return [];
  return appliesFor(profile, landed, seat);
}
