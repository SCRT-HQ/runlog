import type { Pack, Setup } from "@runlog/rules-schema";

import { BASE, DEVICE_IDS, DEVICES, DIALS, isWarp, type DeviceId, type Key } from "./layouts.ts";
import { ACTION_NAMES, PAGE_PLUGIN, PLUGIN, TURNS } from "./plugin.ts";
import { joined, sha1, utf8 } from "./sha1.ts";
import { zip, type ZipEntry } from "./zip.ts";

/**
 * A deck laid out for a pack: its moves on keys, its counters and
 * resources on the numbers, and the setups for its tool ready to hand out.
 *
 * Nothing is typed in here. The ids come off the pack, so a renamed move
 * changes the profile next time one is built rather than going quietly
 * dead on somebody's deck. The plugin ships forty-four of these built by
 * `streamdeck/design/profiles.mjs` and committed; a Marketplace pack is
 * not known when the plugin is packed, so its own page builds one in the
 * browser from this same code.
 *
 * The container is a zip whose single top-level entry is a
 * `<UUID>.sdProfile/` folder. That is not documented anywhere; it is what
 * the Stream Deck app's own `DefaultProfiles` and the profiles bundled
 * with Elgato's Volume Controller plugin turn out to be, and the writer in
 * `zip.ts` matches them entry for entry.
 */

/** What a key face looks like before the plugin draws over it. */
const STATE = {
  FontFamily: "",
  FontSize: 12,
  FontStyle: "",
  FontUnderline: false,
  OutlineThickness: 2,
  ShowTitle: true,
  TitleAlignment: "top",
  TitleColor: "#ffffff",
};

/** One action, as the app stores it on a key or a dial. */
export interface StoredAction {
  ActionID: string;
  LinkedTitle: boolean;
  Name: string;
  Plugin: { Name: string; UUID: string; Version: string };
  Resources: null;
  Settings: Record<string, unknown>;
  State: number;
  States: Record<string, unknown>[];
  UUID: string;
}

/** A page's keys, or a +'s dials, which are two controllers rather than one grid. */
export interface Controller {
  Type: "Keypad" | "Encoder";
  Actions: Record<string, StoredAction> | null;
}

/** One page of a profile, as its own file in the container. */
export interface PageFile {
  Controllers: Controller[];
  Icon: string;
  Name: string;
}

/** The profile's own manifest: which deck it is for, and which pages it has. */
export interface RootFile {
  Device: { Model: string; UUID: string };
  Name: string;
  Pages: { Current: string; Default: string; Pages: string[] };
  Version: string;
}

/** A profile before anything is zipped: the folder it unpacks to, and its files. */
export interface Built {
  folder: string;
  files: Record<string, PageFile | RootFile>;
}

/** One profile to build: a pack's keys, for one deck, under one name. */
export interface ProfileSpec {
  /** What names the file and seeds its ids. Stable: renaming it renames the profile. */
  slug: string;
  device: DeviceId;
  /** What the Stream Deck app calls the profile in somebody's list. */
  name: string;
  keys: Key[];
}

/** The generic layout, which is what a pack with nothing of its own gets. */
export const GENERIC = { slug: "runlog", name: "Runlog" };

/**
 * Stable ids, so regenerating a profile is not a diff.
 *
 * A profile folder, its pages and every action on them want a UUID, and the
 * app does not care where they came from as long as they are unique. Random
 * ones would rewrite every file on every run and bury a real change in the
 * churn, so each is derived from what it is: the same name in, the same
 * UUID out. Version 5 in shape, off a namespace of our own.
 */
const NAMESPACE = sha1(utf8("com.scrthq.runlog.profiles")).subarray(0, 16);

export function stableId(name: string): string {
  const h = sha1(joined(NAMESPACE, utf8(name)));
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const s = [...h.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * One key, as the app stores it.
 *
 * `LinkedTitle` true is what lets the plugin's own title survive a copy of
 * the key to another slot, and `State: 0` with a single `States` entry is
 * every one of our actions: none of them has a second state.
 */
function entry(id: string, spec: Key): StoredAction {
  return {
    ActionID: id,
    LinkedTitle: true,
    Name: ACTION_NAMES[spec.action]!,
    Plugin: PLUGIN,
    Resources: null,
    Settings: spec.settings ?? {},
    State: 0,
    States: [STATE],
    UUID: `${PLUGIN.UUID}.${spec.action}`,
  };
}

/** A page turn, which carries the app's plugin block and an empty face. */
function turn(id: string, which: "next" | "previous"): StoredAction {
  return {
    ActionID: id,
    LinkedTitle: true,
    Name: TURNS[which].Name,
    Plugin: PAGE_PLUGIN,
    Resources: null,
    Settings: {},
    State: 0,
    States: [{}],
    UUID: TURNS[which].UUID,
  };
}

/**
 * What a layout is built from: ids on one side, nothing about where they came from.
 *
 * A pack file has all of this and more; a run's own offer has exactly this
 * and nothing else, which is the point. The plugin follows runs, not packs,
 * so a deck that has never seen the pack file can still lay one out from
 * what the run publishes about itself.
 */
export interface Keyed {
  moves: Array<{ id: string }>;
  counters: Array<{ id: string }>;
  resources: Array<{ id: string }>;
  /** Setups the run would take on, which is what an Apply setup key does. */
  setups: Array<{ id: string; title: string }>;
  /** Setups handed to the tool once, which is what a Command key does. */
  commands: Array<{ id: string; title: string }>;
}

/**
 * A run's offer, as much of it as a layout reads.
 *
 * Mirrored from `apps/web/src/run/offer.ts` the way `streamdeck/src/state.ts`
 * mirrors the whole of it: this package is imported by a browser as well as
 * by Node and takes nothing from either app.
 */
export interface Offered {
  moves?: Array<{ id: string }>;
  trackers?: Array<{ id: string; kind: "counter" | "resource" }>;
  setups?: Array<{ id: string; title: string }>;
  commands?: Array<{ id: string; title: string }>;
}

/**
 * The pack's own layout, as the snapshot publishes it beside the offer.
 *
 * Mirrored from `packages/engine/src/snapshot.ts`. It is the pack rather
 * than the moment: every move the pack declares, gated or not, and every
 * tracker it keeps, whether or not the run would take one right now. Absent
 * from an older page, which is what the fallback to the offer is for.
 */
export interface Laid {
  moves?: Array<{ id: string }>;
  counters?: Array<{ id: string }>;
  resources?: Array<{ id: string }>;
}

/**
 * The pack read off disk, as keys.
 *
 * A hidden counter is left out. `packages/engine/src/snapshot.ts` does not
 * publish one, so a key set to it would say nothing for ever, and hidden
 * is the pack saying it is bookkeeping rather than a number to watch.
 *
 * The setups are the tool's, not the pack's: a setup names a tool and no
 * pack at all, which is `forTool` in `apps/web/src/control/setups.ts`. A
 * pack with no control profile written for it names no tool and gets none.
 * A setup `isWarp` goes to `commands` instead: its operations reach the
 * tool once, and the run's own setup is untouched.
 */
export function fromPack(pack: Pack, setups: Setup[]): Keyed {
  return {
    moves: Object.keys(pack.moves ?? {}).map((id) => ({ id })),
    counters: Object.entries(pack.counters ?? {})
      .filter(([, counter]) => !counter.hidden)
      .map(([id]) => ({ id })),
    resources: Object.keys(pack.resources ?? {}).map((id) => ({ id })),
    setups: setups.filter((s) => !isWarp(s)).map(({ id, title }) => ({ id, title })),
    commands: setups.filter((s) => isWarp(s)).map(({ id, title }) => ({ id, title })),
  };
}

/**
 * The run the deck is following, as keys.
 *
 * The offer's own `commands` is not the warps: it is every setup again,
 * less whatever the wire would drop, because which of the two a key does is
 * the key's own business on the page. A profile has to choose one key per
 * setup, so the warps are taken as the commands and the rest as the setups,
 * and a setup left in both lists is not given a key twice.
 *
 * `isWarp` reads a title here rather than a file: the offer carries no
 * operations, so a warp that only declares itself in its ops lands on an
 * Apply setup key. Both keys reach the same tool with the same document;
 * one writes the run's setup on the way.
 *
 * The moves and the numbers come from the snapshot's `layout` where it has
 * one. The offer is the state's view: a move behind a gate that is shut, or
 * a tracker the step does not take, is not in it, so two builds a minute
 * apart came out different profiles. The layout is the pack, so they do not.
 * A page too old to publish one leaves the offer as the only thing to read.
 */
export function fromOffer(offer: Offered, layout?: Laid | null): Keyed {
  const trackers = offer.trackers ?? [];
  const warps = new Set((offer.commands ?? []).filter((s) => isWarp(s)).map((s) => s.id));
  return {
    moves: (layout?.moves ?? offer.moves ?? []).map(({ id }) => ({ id })),
    counters: (layout?.counters ?? trackers.filter((t) => t.kind === "counter")).map(({ id }) => ({ id })),
    resources: (layout?.resources ?? trackers.filter((t) => t.kind === "resource")).map(({ id }) => ({ id })),
    setups: (offer.setups ?? []).filter((s) => !warps.has(s.id)).map(({ id, title }) => ({ id, title })),
    commands: (offer.commands ?? []).filter((s) => warps.has(s.id)).map(({ id, title }) => ({ id, title })),
  };
}

/**
 * The keys a pack adds to the generic thirteen.
 *
 * Its moves first, because those are what somebody presses; then the
 * numbers it keeps; then the setups for whatever tool it is driven by.
 *
 * The setups and the commands are laid down as one run of keys ordered by
 * title, which is the order the app's own picker lists them in, so a warp
 * sits where its name puts it rather than at the end of the deck.
 *
 * Last, a key that opens the pack's rules in the browser: a pack profile
 * is the one place that key has a pack to open.
 */
export function packKeys(keyed: Keyed): Key[] {
  const keys: Key[] = [];
  for (const { id } of keyed.moves) keys.push({ action: "press", settings: { target: { kind: "move", id } } });
  for (const { id } of keyed.counters) keys.push({ action: "metric", settings: { field: { counter: id } } });
  for (const { id } of keyed.resources) keys.push({ action: "metric", settings: { field: { resource: id } } });
  const handed: Array<{ title: string; key: Key }> = [
    ...keyed.setups.map((s) => ({ title: s.title, key: { action: "setup", settings: { setup: { id: s.id, title: s.title } } } })),
    ...keyed.commands.map((s) => ({ title: s.title, key: { action: "command", settings: { command: { id: s.id, title: s.title } } } })),
  ];
  for (const { key } of handed.sort((a, b) => a.title.localeCompare(b.title))) keys.push(key);
  keys.push({ action: "open", settings: { target: "rules" } });
  return keys;
}

/**
 * Whether a pack has anything of its own to put on a deck.
 *
 * A pack with no moves, counters or resources would build the generic
 * layout with a Rules key on the end, which is a download that gives
 * somebody nothing the plugin did not already install.
 */
/** Whether a layout has anything of the pack's own on it, or is the common keys alone. */
export function laysOut(keyed: Keyed): boolean {
  return keyed.moves.length > 0 || keyed.counters.length > 0 || keyed.resources.length > 0;
}

export function hasKeys(pack: Pack): boolean {
  return laysOut(fromPack(pack, []));
}

/** One page's worth of keys, and whether it keeps room for a turn at either end. */
export interface Page {
  back: boolean;
  more: boolean;
  keys: Key[];
}

/**
 * The keys cut into pages, with room kept for the turns.
 *
 * Every page after the first spends its first position on a way back, and
 * every page with more behind it spends its last on a way on. The last page
 * spends neither, so a layout that fits exactly does not grow a turn key
 * pointing at nothing.
 */
export function paginate(keys: Key[], capacity: number): Page[] {
  const pages: Page[] = [];
  let i = 0;
  while (i < keys.length) {
    const back = pages.length > 0 ? 1 : 0;
    let room = capacity - back;
    const more = keys.length - i > room;
    if (more) room -= 1;
    pages.push({ back: back === 1, more, keys: keys.slice(i, i + room) });
    i += room;
  }
  return pages;
}

/** Row-major: the app names a position column first, and the top-left one is `0,0`. */
const at = (slot: number, columns: number) => `${slot % columns},${Math.floor(slot / columns)}`;

/**
 * One profile, as a set of files, before anything is zipped.
 *
 * `ids` is handed in so a test can run the whole thing on a counter and
 * compare what came out; the default derives them from the profile's own
 * name and is what the committed files are built with.
 */
export function profile({ slug, device, name, keys }: ProfileSpec, ids: (name: string) => string = stableId): Built {
  const { model, columns, rows, dials } = DEVICES[device];
  const capacity = columns * rows;
  const cut = paginate(keys, capacity);

  const files: Record<string, PageFile | RootFile> = {};
  const pageIds: string[] = [];
  for (const [index, page] of cut.entries()) {
    const id = ids(`${slug}/${device}/page/${index}`).toUpperCase();
    pageIds.push(id);

    const actions: Record<string, StoredAction> = {};
    if (page.back) actions[at(0, columns)] = turn(ids(`${slug}/${device}/page/${index}/back`), "previous");
    for (const [n, key] of page.keys.entries()) {
      const slot = (page.back ? 1 : 0) + n;
      actions[at(slot, columns)] = entry(ids(`${slug}/${device}/page/${index}/key/${n}`), key);
    }
    if (page.more) actions[at(capacity - 1, columns)] = turn(ids(`${slug}/${device}/page/${index}/more`), "next");

    const controllers: Controller[] = [{ Type: "Keypad", Actions: actions }];
    if (dials > 0) {
      const wheel: Record<string, StoredAction> = {};
      for (const [n, dial] of DIALS.slice(0, dials).entries()) {
        wheel[`${n},0`] = entry(ids(`${slug}/${device}/page/${index}/dial/${n}`), dial);
      }
      controllers.push({ Type: "Encoder", Actions: wheel });
    }
    files[`Profiles/${id}/manifest.json`] = { Controllers: controllers, Icon: "", Name: "" };
  }

  // The default page is the empty one the app falls back to. It is not in
  // `Pages`, which is why a profile with one page still lists two folders.
  const empty = ids(`${slug}/${device}/default`).toUpperCase();
  files[`Profiles/${empty}/manifest.json`] = { Controllers: [{ Actions: null, Type: "Keypad" }], Icon: "", Name: "" };

  files["manifest.json"] = {
    // Empty, and it has to be: the serial that sits here in a profile the
    // app wrote is one particular deck on one particular desk, and a
    // profile we hand out goes to everybody's.
    Device: { Model: model, UUID: "" },
    Name: name,
    Pages: {
      Current: pageIds[0]!.toLowerCase(),
      Default: empty.toLowerCase(),
      Pages: pageIds.map((id) => id.toLowerCase()),
    },
    Version: "3.0",
  };

  return { folder: `${ids(`${slug}/${device}`).toUpperCase()}.sdProfile`, files };
}

/** A built profile as the bytes of a `.streamDeckProfile`, folders and all. */
export function container({ folder, files }: Built): Uint8Array {
  const entries: ZipEntry[] = [{ name: `${folder}/` }];
  const folders = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  for (const dir of [...folders].sort()) entries.push({ name: `${folder}/${dir}/` });
  for (const [path, body] of Object.entries(files)) {
    entries.push({ name: `${folder}/${path}`, data: utf8(JSON.stringify(body)) });
  }
  return zip(entries);
}

/**
 * The profiles for one layout, one per deck, or just the deck named.
 *
 * `keyed` null is the generic layout: the keys any run wants, whatever pack
 * it is playing, and it takes the generic name and slug with it.
 */
export function specsFor(keyed: Keyed | null, named: { slug: string; name: string }, device?: DeviceId): ProfileSpec[] {
  const keys = keyed ? [...BASE, ...packKeys(keyed)] : [...BASE];
  return (device ? [device] : DEVICE_IDS).map((d) => ({ slug: named.slug, device: d, name: named.name, keys }));
}

/**
 * The profiles for one pack, one per deck, or just the deck named.
 *
 * The slug a profile takes here is the pack's own id, which is what a
 * download from a pack's page is named after; the shipped forty-four are
 * written under the short slugs their files are named by, so
 * `design/profiles.mjs` puts its own slug on each spec before building.
 */
export function specs(pack: Pack | null, setups: Setup[], device?: DeviceId): ProfileSpec[] {
  return specsFor(pack && fromPack(pack, setups), pack ? { slug: pack.id, name: pack.title } : GENERIC, device);
}
