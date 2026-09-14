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
 * run is talking to is on offer: the same seven fit any Elden Ring pack
 * somebody writes, which is the whole point of the document being its
 * own document.
 */
const files = import.meta.glob("../../../../packs/setups/*.yaml", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;

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

/** What a run keeps of the setup it chose. */
export interface ChosenSetup {
  id: string;
  version: string;
  title: string;
  /** Copied rather than referenced: see `chose`. */
  ops: Setup["ops"];
}

/**
 * A setup, as a run will keep it.
 *
 * The operations are copied in rather than looked up later. A run is a
 * record of what happened, and what happened is that this player was
 * handed these things; a shipped file that changes next month changes
 * what a new run gets, not what an old one got. The id and version are
 * kept beside them so a screen can still say which one it was.
 */
export function chose(setup: Setup): ChosenSetup {
  return { id: setup.id, version: setup.version, title: setup.title, ops: setup.ops.map((o) => ({ ...o })) };
}

/** A chosen setup read back off a stored run, which came from a device and is not to be trusted. */
export function chosenFrom(value: unknown): ChosenSetup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (name: string) => (typeof raw[name] === "string" && raw[name] ? (raw[name] as string) : null);
  const id = text("id");
  const title = text("title");
  const version = text("version");
  if (!id || !title || !version) return null;
  const ops = Array.isArray(raw["ops"])
    ? raw["ops"]
        .map((o) => {
          if (!o || typeof o !== "object") return null;
          const op = (o as Record<string, unknown>)["op"];
          if (typeof op !== "string" || !op) return null;
          const args = (o as Record<string, unknown>)["args"];
          const once = (o as Record<string, unknown>)["once"] === true;
          return {
            op,
            ...(args && typeof args === "object" && !Array.isArray(args) ? { args: { ...(args as Record<string, unknown>) } } : {}),
            ...(once ? { once: true } : {}),
          };
        })
        .filter((o): o is Setup["ops"][number] => o !== null)
    : [];
  if (ops.length === 0) return null;
  return { id, version, title, ops };
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
  const ops: ProfileOp[] = chosen.ops.map((o) => ({ op: o.op, args: { ...(o.args ?? {}) }, ...(o.once ? { once: true as const } : {}) }));
  return { ...profile, setup: [...(profile.setup ?? []), ...ops] };
}
