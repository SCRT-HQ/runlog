import type { Pack } from "@runlog/rules-schema";
import { catalogFor, opDef, rangeOfValue } from "./catalog.ts";

/**
 * The mapping from what the dice said to what a tool should do.
 *
 * The server has its own reader for this, deliberately permissive: it
 * takes what is well formed and drops the rest, because what arrives
 * there came out of a browser and is not to be trusted. This end is the
 * other half, where a profile is written: it knows the pack, so it can
 * say which row will never match anything, and it knows what the tool
 * accepts, so it can say which argument is out of range before anybody
 * plays an hour to find out.
 *
 * Shape and field names match the wire exactly. See docs/stream-api.md.
 */

export interface ProfileOp {
  op: string;
  args: Record<string, unknown>;
}

export interface ProfileRow {
  /** What it matches: a table, an entry in one, or a tag an entry carries. */
  table?: string;
  entry?: string;
  tag?: string;
  label?: string;
  /** Seconds, or `until` for the unit it landed in, or neither. */
  for?: number;
  until?: "unit";
  /** A seat's name, or absent for everyone. */
  to?: string;
  ops: ProfileOp[];
}

export interface ControlProfile {
  tool?: string;
  /**
   * The pack this was written for, by id.
   *
   * Only the ones shipped with the app need it, so a picker can offer
   * the right one for the run being played rather than a list of files
   * somebody has to recognise. The server ignores it; matching a rule is
   * done by table and entry, and a profile pointed at the wrong pack
   * simply matches nothing.
   */
  pack?: string;
  /** What to call it in a list. */
  title?: string;
  setup?: ProfileOp[];
  rows?: ProfileRow[];
}

export const EMPTY: ControlProfile = { tool: "TarnishedTool", setup: [], rows: [] };

/** Whether there is anything here worth sending. */
export function isEmpty(profile: ControlProfile | null | undefined): boolean {
  if (!profile) return true;
  return (profile.setup ?? []).length === 0 && (profile.rows ?? []).length === 0;
}

/** How a row says what it matches, for a panel that has to draw it. */
export type Selector = "entry" | "tag" | "table";

export function selectorOf(row: ProfileRow): Selector {
  if (row.entry !== undefined) return "entry";
  if (row.tag !== undefined) return "tag";
  return "table";
}

/** Every tag any entry in the pack carries, which is what a tag row picks from. */
export function tagsOf(pack: Pack): string[] {
  const seen = new Set<string>();
  for (const table of Object.values(pack.tables ?? {})) {
    for (const entry of table.entries ?? []) {
      for (const tag of entry.tags ?? []) seen.add(tag);
    }
  }

  return [...seen].sort();
}

/** The tables a row can match, by id and title. */
export function tablesOf(pack: Pack): Array<{ id: string; title: string }> {
  return Object.entries(pack.tables ?? {}).map(([id, table]) => ({ id, title: table.title ?? id }));
}

/** The entries of one table, by id and the words a person will recognize. */
export function entriesOf(pack: Pack, table: string | undefined): Array<{ id: string; text: string }> {
  if (!table) return [];
  return (pack.tables?.[table]?.entries ?? []).map((e) => ({ id: e.id, text: e.title ?? e.text }));
}

/** What a row will match, said in the pack's own words, for a panel to show. */
export function describes(pack: Pack, row: ProfileRow): string {
  if (row.entry !== undefined) {
    const table = row.table ? pack.tables?.[row.table] : undefined;
    const entry = row.table ? entriesOf(pack, row.table).find((e) => e.id === row.entry) : undefined;
    const where = table?.title ?? row.table ?? "any table";
    return entry ? `${where} · ${entry.text}` : `${where} · ${row.entry}`;
  }

  if (row.tag !== undefined) return `Anything tagged ${row.tag}`;
  const table = row.table ? pack.tables?.[row.table] : undefined;
  return table ? `Anything from ${table.title ?? row.table}` : "Nothing";
}

export interface Complaint {
  where: string;
  says: string;
  /** A row that can never fire, rather than one that might misfire. */
  fatal?: boolean;
}

/**
 * What is wrong with a profile, said before anyone plays an hour to find
 * out.
 *
 * Three kinds of wrong, and the difference matters. A row selecting
 * nothing in this pack will never fire, which is almost always a typo or
 * a pack that moved on. An argument outside what the tool accepts will be
 * refused mid-run, which looks like the tool being broken. And an
 * operation the catalog has never heard of may be perfectly good, since
 * the catalog is only what we happened to know when this was written.
 */
export function complaints(pack: Pack, profile: ControlProfile): Complaint[] {
  const out: Complaint[] = [];
  const catalog = catalogFor(profile.tool);
  const tags = new Set(tagsOf(pack));

  const checkOps = (where: string, ops: ProfileOp[]) => {
    ops.forEach((op, i) => {
      const at = `${where} · ${i + 1}`;
      const def = opDef(catalog, op.op);
      if (!def) {
        out.push({ where: at, says: `Nothing known about ${op.op}. It will be sent anyway, and refused if the tool has no such thing.` });
        return;
      }

      for (const arg of def.args) {
        const value = op.args[arg.name];
        if (value === undefined || value === "") {
          if (arg.required) out.push({ where: at, says: `${def.label} needs ${arg.label}.`, fatal: true });
          continue;
        }

        if (arg.kind === "number") {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            out.push({ where: at, says: `${arg.label} should be a number.`, fatal: true });
            continue;
          }

          const bounds = op.op === "value.set" && arg.name === "value" ? rangeOfValue(String(op.args["name"] ?? "")) : { least: arg.least, most: arg.most };
          if (bounds && bounds.least !== undefined && n < bounds.least) out.push({ where: at, says: `${arg.label} is below ${bounds.least}, which the tool will refuse.` });
          if (bounds && bounds.most !== undefined && n > bounds.most) out.push({ where: at, says: `${arg.label} is above ${bounds.most}, which the tool will refuse.` });
        }

        if (arg.kind === "choice" && arg.options && !arg.options.includes(String(value))) {
          out.push({ where: at, says: `${arg.label} is not one this build knows: ${String(value)}.` });
        }
      }
    });
  };

  checkOps("The run's terms", profile.setup ?? []);

  (profile.rows ?? []).forEach((row, i) => {
    const where = row.label || describes(pack, row) || `Row ${i + 1}`;
    if (row.entry === undefined && row.tag === undefined && row.table === undefined) {
      out.push({ where, says: "Matches nothing, so it will never fire.", fatal: true });
    } else if (row.tag !== undefined && !tags.has(row.tag)) {
      out.push({ where, says: `No entry in this pack is tagged ${row.tag}.`, fatal: true });
    } else if (row.table !== undefined && !pack.tables?.[row.table]) {
      out.push({ where, says: `This pack has no table called ${row.table}.`, fatal: true });
    } else if (row.entry !== undefined && row.table !== undefined && !entriesOf(pack, row.table).some((e) => e.id === row.entry)) {
      out.push({ where, says: `That table has no entry called ${row.entry}.`, fatal: true });
    }

    if (row.ops.length === 0) out.push({ where, says: "Does nothing.", fatal: true });
    checkOps(where, row.ops);
  });

  return out;
}

/** What goes over the wire and into a file: no empties, nothing extra. */
export function tidy(profile: ControlProfile): ControlProfile {
  const ops = (list: ProfileOp[]) => list.filter((o) => o.op).map((o) => ({ op: o.op, args: { ...o.args } }));
  const setup = ops(profile.setup ?? []);
  const rows = (profile.rows ?? [])
    .map((row) => {
      const out: ProfileRow = { ops: ops(row.ops) };
      if (row.table) out.table = row.table;
      if (row.entry) out.entry = row.entry;
      if (row.tag) out.tag = row.tag;
      if (row.label) out.label = row.label;
      if (row.to && row.to !== "all") out.to = row.to;
      if (row.for !== undefined && row.for > 0) out.for = Math.round(row.for);
      else if (row.until === "unit") out.until = "unit";
      return out;
    })
    .filter((row) => row.ops.length > 0);
  return {
    ...(profile.tool ? { tool: profile.tool } : {}),
    ...(profile.pack ? { pack: profile.pack } : {}),
    ...(profile.title ? { title: profile.title } : {}),
    ...(setup.length ? { setup } : {}),
    ...(rows.length ? { rows } : {}),
  };
}

/**
 * A profile read back from a file somebody was handed.
 *
 * The same defensiveness the server applies, for the same reason: this
 * arrived from outside. Anything unreadable is a null rather than a
 * half-built profile, since a profile that is silently three quarters of
 * what somebody wrote is worse than one that plainly did not load.
 */
export function parse(text: string): ControlProfile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const doc = raw as Record<string, unknown>;
  const opsOf = (value: unknown): ProfileOp[] =>
    Array.isArray(value)
      ? value
          .map((o): ProfileOp | null => {
            if (!o || typeof o !== "object") return null;
            const op = (o as Record<string, unknown>)["op"];
            if (typeof op !== "string" || !op) return null;
            const args = (o as Record<string, unknown>)["args"];
            return { op, args: args && typeof args === "object" && !Array.isArray(args) ? ({ ...args } as Record<string, unknown>) : {} };
          })
          .filter((o): o is ProfileOp => o !== null)
      : [];

  const rows = Array.isArray(doc["rows"])
    ? doc["rows"]
        .map((r): ProfileRow | null => {
          if (!r || typeof r !== "object") return null;
          const row = r as Record<string, unknown>;
          const text_ = (name: string) => (typeof row[name] === "string" ? (row[name] as string) : undefined);
          const out: ProfileRow = { ops: opsOf(row["ops"]) };
          const table = text_("table");
          const entry = text_("entry");
          const tag = text_("tag");
          const label = text_("label");
          const to = text_("to");
          if (table) out.table = table;
          if (entry) out.entry = entry;
          if (tag) out.tag = tag;
          if (label) out.label = label;
          if (to) out.to = to;
          if (typeof row["for"] === "number" && row["for"] > 0) out.for = row["for"];
          else if (row["until"] === "unit") out.until = "unit";
          return out;
        })
        .filter((r): r is ProfileRow => r !== null)
    : [];

  return {
    ...(typeof doc["tool"] === "string" && doc["tool"] ? { tool: doc["tool"] } : {}),
    ...(typeof doc["pack"] === "string" && doc["pack"] ? { pack: doc["pack"] } : {}),
    ...(typeof doc["title"] === "string" && doc["title"] ? { title: doc["title"] } : {}),
    setup: opsOf(doc["setup"]),
    rows,
  };
}
