import { loadSetupText, type Setup } from "@runlog/rules-schema";
import { listSetups } from "../storage/db.ts";
import type { ControlProfile, ProfileOp } from "./profile.ts";

/**
 * The setups that ship with the app.
 *
 * Read the way the shipped profiles are read, and for the same reason:
 * handing somebody a file to find and import before anything works is a
 * poor way to start a run.
 *
 * What is different is who they are for. A profile is written against a
 * pack, so the picker offers the pack's own. A setup is written against
 * a *tool*, and names no pack at all, so every setup for the tool this
 * run is talking to is on offer: the same setups fit any Elden Ring pack
 * somebody writes, which is the whole point of the document being its
 * own document.
 */
const files = import.meta.glob("../../../../packs/setups/*.yaml", { query: "?raw", import: "default" }) as Record<
  string,
  () => Promise<string>
>;

let loaded: Setup[] | null = null;

/** Every shipped setup, read once, in the order a list should show them. */
export async function shippedSetups(): Promise<Setup[]> {
  if (loaded) return loaded;
  const out: Setup[] = [];
  for (const read of Object.values(files)) {
    // One that does not parse is a bug in this repository rather than
    // something to put in front of anybody: `check:packs` validates every
    // one of these on the way in, so silence here is the right answer.
    const parsed = loadSetupText(await read(), "yaml");
    if (parsed.ok) out.push(parsed.setup);
  }

  loaded = out.sort((a, b) => a.title.localeCompare(b.title));
  return loaded;
}

/**
 * Every setup available here: the ones that ship, and the ones kept.
 *
 * Seven ship with the app. This is those plus whatever somebody added
 * from a file or from the marketplace, which is the difference between a
 * shelf and a fixed list. A kept one wins where the ids collide, on the
 * same rule the pack shelf uses: what you chose to keep beats what
 * happened to be in the bundle.
 *
 * A kept setup that no longer parses is left out rather than shown
 * broken. That can happen honestly: a file written against a later
 * version of the format than this build understands.
 */
export async function setupsHere(): Promise<Setup[]> {
  const byId = new Map((await shippedSetups()).map((s) => [s.id, s]));
  for (const kept of await listSetups()) {
    const parsed = loadSetupText(kept.source, kept.format);
    if (parsed.ok) byId.set(parsed.setup.id, parsed.setup);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The ones this run could actually use.
 *
 * A setup names its tool because operation names say nothing between
 * programs: two tools for two games could both have a `warp.position`,
 * and one meant for the other reaching this game would move somebody for
 * no reason. A run whose profile names no tool is talking to anything
 * that listens, and is offered nothing rather than everything.
 */
export function forTool(all: Setup[], tool: string | undefined): Setup[] {
  if (!tool) return [];
  return all.filter((s) => s.tool.toLowerCase() === tool.toLowerCase());
}

/** One setup a run's terms were seeded from, for a screen that says where they came from. */
export interface SetupCredit {
  id: string;
  version: string;
  title: string;
}

/**
 * What a run keeps of the setups it chose, and of what was done to them.
 *
 * Three things, and they answer three different questions. `ops` is what
 * will actually be sent, which is the only one the tool cares about.
 * `from` is where those operations came from, so a screen can still name
 * the setups. `edited` is whether they are still what those setups said.
 *
 * That last one earns its place. Once the list is editable, "played
 * under Cleric" stops being a fact and becomes a claim, and a log that
 * sells itself on being an honest record should not be making claims it
 * cannot check. So the flag is set the moment the operations stop
 * matching what the setups handed over, and the screen says "seeded
 * from" rather than "played under" when it is.
 */
export interface ChosenSetup {
  /** The setups this was seeded from, in the order they were applied. */
  from: SetupCredit[];
  ops: Setup["ops"];
  /** True once the operations are no longer what `from` handed over. */
  edited?: boolean;
}

const copyOps = (ops: Setup["ops"]): Setup["ops"] => ops.map((o) => ({ ...o, ...(o.args ? { args: { ...o.args } } : {}) }));

const creditOf = (setup: Setup): SetupCredit => ({ id: setup.id, version: setup.version, title: setup.title });

/**
 * Several setups, as a run will keep them.
 *
 * The operations are copied in rather than looked up later. A run is a
 * record of what happened, and what happened is that this player was
 * handed these things; a shipped file that changes next month changes
 * what a new run gets, not what an old one got.
 *
 * They are concatenated in the order chosen, and nothing is merged or
 * de-duplicated. Two setups that both set the same value leave both
 * operations in the list and the last one wins, which is what a tool
 * would do with them anyway; two that both hand over runes hand over
 * both lots. Resolving that quietly would be the wrong favor, because
 * the list is in front of the player and a line they did not want is a
 * line they can delete.
 */
export function combine(setups: Setup[]): ChosenSetup | null {
  if (setups.length === 0) return null;
  return { from: setups.map(creditOf), ops: setups.flatMap((s) => copyOps(s.ops)) };
}

/** One setup, as a run will keep it. */
export function chose(setup: Setup): ChosenSetup {
  return combine([setup])!;
}

/**
 * The same choice, with the operations the player left in it.
 *
 * `edited` is worked out rather than asked for: an editor that had to
 * remember to set it is an editor that will one day forget, and the
 * whole value of the flag is that it cannot be wrong.
 */
export function edit(chosen: ChosenSetup | null, ops: Setup["ops"], seeded: Setup["ops"]): ChosenSetup | null {
  if (ops.length === 0 && (!chosen || chosen.from.length === 0)) return null;
  const from = chosen?.from ?? [];
  // Nothing to have deviated from: a list written by hand is not an
  // edited loadout, it is somebody's own terms.
  const same = from.length === 0 || JSON.stringify(ops) === JSON.stringify(seeded);
  return { from, ops: copyOps(ops), ...(same ? {} : { edited: true }) };
}

/**
 * The same operations, in the shape a profile holds them.
 *
 * A setup's `args` are optional and a profile's are not, which is the
 * whole of the difference. Both directions live here so the editor on
 * the start page and the frame a tool is sent agree about it, rather
 * than each doing the conversion its own way.
 */
export function asProfileOps(ops: Setup["ops"]): ProfileOp[] {
  return ops.map((o) => ({ op: o.op, args: { ...(o.args ?? {}) }, ...(o.once ? { once: true as const } : {}) }));
}

/** The same, marked as the run's chosen loadout rather than the pack's terms. */
function asChosenOps(ops: Setup["ops"]): ProfileOp[] {
  return asProfileOps(ops).map((o) => ({ ...o, chosen: true as const }));
}

/** And back, for an editor that hands a profile's shape to something that keeps a setup's. */
export function asSetupOps(ops: ProfileOp[]): Setup["ops"] {
  return ops.map((o) => ({ op: o.op, args: { ...o.args }, ...(o.once ? { once: true } : {}) }));
}

/** How a screen should describe where a run's terms came from. */
export function creditLine(chosen: ChosenSetup | null): string | null {
  if (!chosen || chosen.ops.length === 0) return null;
  // Operations with no loadout behind them: written here, by hand.
  if (chosen.from.length === 0) return "Your own terms";
  const names = chosen.from.map((f) => f.title);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return chosen.edited ? `Seeded from ${list}, then edited` : `Played under ${list}`;
}

/** One operation off a stored record, which came from a device and is not to be trusted. */
function opFrom(value: unknown): Setup["ops"][number] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const op = raw["op"];
  if (typeof op !== "string" || !op) return null;
  const args = raw["args"];
  return {
    op,
    ...(args && typeof args === "object" && !Array.isArray(args) ? { args: { ...(args as Record<string, unknown>) } } : {}),
    ...(raw["once"] === true ? { once: true } : {}),
  };
}

/**
 * A chosen setup read back off a stored run.
 *
 * Two shapes, because runs written before this was plural are sitting in
 * libraries on people's devices and one of them may be open right now.
 * The old one is a single `{ id, version, title, ops }`; it is read as a
 * run seeded from that one setup, which is exactly what it was.
 */
export function chosenFrom(value: unknown): ChosenSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const ops = Array.isArray(raw["ops"]) ? raw["ops"].map(opFrom).filter((o): o is Setup["ops"][number] => o !== null) : [];
  if (ops.length === 0) return null;

  const text = (from: Record<string, unknown>, name: string) =>
    typeof from[name] === "string" && from[name] ? (from[name] as string) : null;

  // The shape this build writes.
  if (Array.isArray(raw["from"])) {
    const from: SetupCredit[] = [];
    for (const entry of raw["from"]) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const id = text(e, "id");
      const title = text(e, "title");
      const version = text(e, "version");
      if (id && title && version) from.push({ id, version, title });
    }
    return { from, ops, ...(raw["edited"] === true ? { edited: true } : {}) };
  }

  // The shape a run written before this was plural carries.
  const id = text(raw, "id");
  const title = text(raw, "title");
  const version = text(raw, "version");
  if (!id || !title || !version) return null;
  return { from: [{ id, version, title }], ops };
}

/**
 * The profile a tool should actually be sent, with the run's setup in it.
 *
 * One field on the wire rather than two. The server already knows how to
 * apply `setup` on attach and how to hold back a `once` until the next
 * run, so a setup chosen here reaches a tool through the path that was
 * already there; nothing on the server had to learn what a setup is.
 *
 * Order matters: the profile's own terms first, then the run's. The
 * profile is the pack author saying what this pack needs of the game;
 * the setup is the player saying what they are starting with. Where both
 * name the same setting, the player's choice is applied last and wins.
 */
export function withChosen(profile: ControlProfile, chosen: ChosenSetup | null): ControlProfile {
  if (!chosen || chosen.ops.length === 0) return profile;
  return { ...profile, setup: [...(profile.setup ?? []), ...asChosenOps(chosen.ops)] };
}
