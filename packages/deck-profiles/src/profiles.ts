import { groupOf, SETUP_GROUPS, type SetupGroup } from "@runlog/rules-schema";
import type { Pack } from "@runlog/rules-schema";

import {
  BASE,
  DEVICE_IDS,
  DEVICES,
  DIALS,
  FRAMES,
  POOLS,
  SPILLS,
  UTILITY,
  type DeviceId,
  type Frame,
  type Key,
  type Pool,
} from "./layouts.ts";
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

/** A frame filled for one profile: the cells that stay put, and the queues that page. */
export interface Zones {
  frame: Frame;
  queues: Queues;
}

/** One profile to build: a pack's keys, for one deck, under one name. */
export interface ProfileSpec {
  /** What names the file and seeds its ids. Stable: renaming it renames the profile. */
  slug: string;
  device: DeviceId;
  /** What the Stream Deck app calls the profile in somebody's list. */
  name: string;
  keys: Key[];
  /** How this deck arranges those keys, where it is one with a frame. The rest lay `keys` down in order. */
  zones?: Zones;
}

/** The generic layout, which is what a pack with nothing of its own gets. */
export const GENERIC = { slug: "runlog", name: "Runlog" };

/**
 * What the Stream Deck app calls a profile Runlog laid out for a pack.
 *
 * Every one of them carries the mark: the four the plugin ships, the one
 * the Install key hands over, and the one a pack's page downloads. One
 * pack is then one name in the app's list however the profile got there,
 * rather than two entries saying the same thing.
 *
 * Nothing collides, because Runlog does not make two profiles for one
 * pack: a pack the plugin ships one for is switched to rather than built
 * again. The generic profile is nobody's pack and does not come through
 * here.
 *
 * This is the one place the mark is spelled. It is exported for the tests
 * that check the name; every caller takes it through {@link specsFor}.
 */
export function shippedName(title: string): string {
  return `${title} (Runlog)`;
}

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
  setups: Array<{ id: string; title: string; group: SetupGroup }>;
  /** Setups handed to the tool once, which is what a Command key does. */
  commands: Array<{ id: string; title: string; group: SetupGroup }>;
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
 * As much of a setup as a layout reads.
 *
 * A setup off disk is a whole file: a tool, a version, a license and up to
 * two hundred operations. A setup the deck remembered off a run it followed
 * is two fields and whether the run called it a command. Both name one key,
 * so both are taken here, and the operations are optional because only one
 * of the two has any.
 */
export type Handed = { id: string; title: string; group?: SetupGroup; ops?: Array<{ op: string }> };

/**
 * A setup with its group settled, whatever it arrived carrying.
 *
 * A file read off disk declares one. An offer carries one too, now that
 * the page sends it. A page too old to send one leaves only the title,
 * and a title beginning with Warp is the last of the old guess: it is kept
 * for that case alone rather than as how anything decides, because a deck
 * following an older page should still put the warps on the Warp key.
 */
function named(s: { id: string; title: string; group?: SetupGroup; ops?: Array<{ op: string }> }): {
  id: string;
  title: string;
  group: SetupGroup;
} {
  const group = s.group ?? (s.ops ? groupOf({ ops: s.ops as never, title: s.title }) : s.title.startsWith("Warp") ? "warp" : "loadout");
  return { id: s.id, title: s.title, group };
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
 * A setup whose group is `warp` goes to `commands` instead: its operations reach the
 * tool once, and the run's own setup is untouched.
 */
export function fromPack(pack: Pack, setups: Handed[]): Keyed {
  return {
    moves: Object.keys(pack.moves ?? {}).map((id) => ({ id })),
    counters: Object.entries(pack.counters ?? {})
      .filter(([, counter]) => !counter.hidden)
      .map(([id]) => ({ id })),
    resources: Object.keys(pack.resources ?? {}).map((id) => ({ id })),
    // A warp is handed over once and leaves the run's own setup alone, so
    // it is a Command; everything else is an Apply setup.
    setups: setups.map(named).filter((s) => s.group !== "warp"),
    commands: setups.map(named).filter((s) => s.group === "warp"),
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
 * The group comes off the offer, which now carries it. It used to be read
 * off the title here, because the offer carried no operations and a warp
 * that declared itself only in its ops landed on an Apply setup key.
 * Both keys reach the same tool with the same document; one writes the
 * run's setup on the way.
 *
 * The moves and the numbers come from the snapshot's `layout` where it has
 * one. The offer is the state's view: a move behind a gate that is shut, or
 * a tracker the step does not take, is not in it, so two builds a minute
 * apart came out different profiles. The layout is the pack, so they do not.
 * A page too old to publish one leaves the offer as the only thing to read.
 */
export function fromOffer(offer: Offered, layout?: Laid | null): Keyed {
  const trackers = offer.trackers ?? [];
  return {
    moves: (layout?.moves ?? offer.moves ?? []).map(({ id }) => ({ id })),
    counters: (layout?.counters ?? trackers.filter((t) => t.kind === "counter")).map(({ id }) => ({ id })),
    resources: (layout?.resources ?? trackers.filter((t) => t.kind === "resource")).map(({ id }) => ({ id })),
    setups: (offer.setups ?? []).map(named).filter((s) => s.group !== "warp"),
    commands: (offer.commands ?? []).map(named).filter((s) => s.group === "warp"),
  };
}

/** The key that opens a pack's rules, which is the one key only a pack profile carries. */
const RULES: Key = { action: "open", settings: { target: "rules" } };

/** A pack's keys, one queue per pool: what an eye reads, what a tool is handed, what a hand presses. */
export type Queues = Record<Pool, Key[]>;

/**
 * The keys a pack adds to the generic twelve, in three queues.
 *
 * `moves` is the pack's own moves, in the order the pack declares them.
 *
 * `setups` is the setups for whatever tool the pack is driven by. The
 * setups and the commands are one run of keys ordered by title, which is
 * the order the app's own picker lists them in, so a warp sits where its
 * name puts it rather than at the end of the deck.
 *
 * `numbers` is what somebody reads: the counters the pack shows, then its
 * resources. Both of those are keys as well, which is why the deck marks
 * them with a stepper rather than the readout's bars, but a hand goes to
 * them between scenes rather than mid-press.
 */
export function queuesFor(keyed: Keyed): Queues {
  const moves: Key[] = keyed.moves.map(({ id }) => ({ action: "press", settings: { target: { kind: "move", id } } }));
  // One key per kind, not one per file. A pack with forty loadouts and
  // twenty warps used to take sixty keys, which paged a Mini out to
  // twenty-one pages and buried the pack's own moves behind them. These
  // keys browse instead: a press moves to the next of that kind and a hold
  // applies the one on the face.
  const setups: Key[] = [];
  for (const group of SETUP_GROUPS) {
    // A warp is handed to the tool once rather than taken on by the run, so
    // its key is a Command. The other four change what the run is played
    // under, so they are Apply setup keys.
    if (group === "warp") {
      if (keyed.commands.some((s) => s.group === group)) setups.push({ action: "command", settings: { group } });
    } else if (keyed.setups.some((s) => s.group === group)) {
      setups.push({ action: "setup", settings: { group } });
    }
  }

  const numbers: Key[] = [];
  for (const { id } of keyed.counters) numbers.push({ action: "metric", settings: { field: { counter: id } } });
  for (const { id } of keyed.resources) numbers.push({ action: "metric", settings: { field: { resource: id } } });

  return { numbers, setups, moves };
}

/**
 * The same keys as one run, which is what a deck with no frame lays down.
 *
 * Last of all, a key that opens the pack's rules in the browser: a framed
 * deck has that key on its utility page, and a Mini and a + have no such
 * page of their own to put it on.
 */
export function packKeys(keyed: Keyed): Key[] {
  const { moves, setups, numbers } = queuesFor(keyed);
  return [...moves, ...setups, ...numbers, RULES];
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
 *
 * `trailing` says a page of somebody else's follows these, which is what
 * the utility page is: every page cut here then spends a cell on the way
 * on, including the last.
 */
export function paginate(keys: Key[], capacity: number, trailing = false): Page[] {
  const pages: Page[] = [];
  let i = 0;
  while (i < keys.length) {
    const back = pages.length > 0 ? 1 : 0;
    let room = capacity - back;
    const more = trailing || keys.length - i > room;
    if (more) room -= 1;
    pages.push({ back: back === 1, more, keys: keys.slice(i, i + room) });
    i += room;
  }
  return pages;
}

/** One page of a framed layout: what sits in each cell, and which turns it needs. */
export interface FramedPage {
  back: boolean;
  more: boolean;
  keys: Record<string, Key>;
}

/** How far down each queue a page has got. */
type Taken = Record<Pool, number>;

/**
 * The three queues poured into a frame, a page at a time.
 *
 * Each pool takes its own queue first. Whatever cells are left over in a
 * pool are cells whose queue has run dry, so another queue spills into
 * them, each looking where the frame's `spill` sends it: the moves take
 * the setups row before they take the numbers, and so on. That is what
 * keeps a pack with forty moves and two counters from paging through half
 * an empty deck.
 *
 * Every one of these pages has a page after it, because the utility page
 * ends the profile, so every one spends the next cell. The utility page
 * itself is the frame's own, cell for cell, and spends the one back.
 *
 * A page that took no key at all ends the run. Neither frame here can
 * reach that, but this is exported, and a frame whose pools are all turn
 * cells would otherwise page for ever.
 */
export function framedPages(frame: Frame, queues: Queues): FramedPage[] {
  const pages: FramedPage[] = [];
  let taken: Taken = { numbers: 0, setups: 0, moves: 0 };
  for (;;) {
    const back = pages.length > 0;
    // The way on is always spent: the utility page follows whatever the
    // queues did here.
    const turns = new Set([...(back ? [frame.turns.previous] : []), frame.turns.next]);
    const keys: Record<string, Key> = {};
    for (const { key, at } of frame.fixed) keys[at] = key;

    const got: Taken = { ...taken };
    const spare: Record<Pool, string[]> = { numbers: [], setups: [], moves: [] };
    for (const pool of POOLS) {
      for (const cell of frame.pools[pool]) {
        if (turns.has(cell)) continue;
        if (got[pool] < queues[pool].length) keys[cell] = queues[pool][got[pool]++]!;
        else spare[pool].push(cell);
      }
    }
    for (const pool of SPILLS) {
      for (const into of frame.spill[pool]) {
        while (got[pool] < queues[pool].length && spare[into].length > 0) {
          keys[spare[into].shift()!] = queues[pool][got[pool]++]!;
        }
      }
    }

    pages.push({ back, more: true, keys });
    const left = POOLS.some((pool) => got[pool] < queues[pool].length);
    // A page that takes no key once it has paid for the turn is a page
    // that cannot page: keep what fit and go to the utility page, rather
    // than cut another as empty as this one.
    const stuck = POOLS.every((pool) => got[pool] === taken[pool]);
    taken = got;
    if (!left || stuck) break;
  }

  // The last page of every profile, and the one page that is not the run's:
  // the keys that are not about the run in hand, and the way back in the
  // cell every other page turns back from.
  const keys: Record<string, Key> = {};
  for (const { key, at } of frame.utility) keys[at] = key;
  pages.push({ back: true, more: false, keys });
  return pages;
}

/** Row-major: the app names a position column first, and the top-left one is `0,0`. */
const at = (slot: number, columns: number) => `${slot % columns},${Math.floor(slot / columns)}`;

/** The cells of a page, top row first and left to right, which is the order they are written in. */
function ordered(keys: Record<string, Key>): string[] {
  return Object.keys(keys).sort((a, b) => {
    const [ac, ar] = a.split(",").map(Number) as [number, number];
    const [bc, br] = b.split(",").map(Number) as [number, number];
    return ar - br || ac - bc;
  });
}

/** A sequential page as cells, so both paths hand the writer the same thing. */
function sequential(page: Page, columns: number): Record<string, Key> {
  const keys: Record<string, Key> = {};
  for (const [n, key] of page.keys.entries()) keys[at((page.back ? 1 : 0) + n, columns)] = key;
  return keys;
}

/**
 * One profile, as a set of files, before anything is zipped.
 *
 * `ids` is handed in so a test can run the whole thing on a counter and
 * compare what came out; the default derives them from the profile's own
 * name and is what the committed files are built with.
 */
export function profile({ slug, device, name, keys, zones }: ProfileSpec, ids: (name: string) => string = stableId): Built {
  const { model, columns, rows, dials } = DEVICES[device];
  const capacity = columns * rows;
  // A framed deck keeps its own cells for the turns; a sequential one
  // spends its first slot going back and its last going on.
  const turns = zones ? zones.frame.turns : { previous: at(0, columns), next: at(capacity - 1, columns) };
  // Both paths end on the utility page. A deck with no frame gets it as
  // one more cut page, so it pays for the way back like any other.
  const cut: FramedPage[] = zones
    ? framedPages(zones.frame, zones.queues)
    : [...paginate(keys, capacity, true), { back: true, more: false, keys: UTILITY }].map((page) => ({
        back: page.back,
        more: page.more,
        keys: sequential(page, columns),
      }));

  const files: Record<string, PageFile | RootFile> = {};
  const pageIds: string[] = [];
  for (const [index, page] of cut.entries()) {
    const id = ids(`${slug}/${device}/page/${index}`).toUpperCase();
    pageIds.push(id);

    const actions: Record<string, StoredAction> = {};
    // Every page but the first turns back, always from the same cell.
    if (page.back) actions[turns.previous] = turn(ids(`${slug}/${device}/page/${index}/back`), "previous");
    for (const cell of ordered(page.keys)) {
      actions[cell] = entry(ids(`${slug}/${device}/page/${index}/key/${cell}`), page.keys[cell]!);
    }
    if (page.more) actions[turns.next] = turn(ids(`${slug}/${device}/page/${index}/more`), "next");

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
 *
 * `named.name` is the pack's title. The mark goes on here rather than at
 * whichever caller asked, so a profile the plugin ships, one the Install
 * key hands over and one a pack's page downloads all arrive under one
 * name.
 */
export function specsFor(keyed: Keyed | null, named: { slug: string; name: string }, device?: DeviceId): ProfileSpec[] {
  const keys = keyed ? [...BASE, ...packKeys(keyed)] : [...BASE];
  const name = keyed ? shippedName(named.name) : named.name;
  return (device ? [device] : DEVICE_IDS).map((d) => {
    const spec: ProfileSpec = { slug: named.slug, device: d, name, keys };
    const frame = FRAMES[d];
    return frame ? { ...spec, zones: zonesFor(frame, keyed) } : spec;
  });
}

/**
 * One deck's frame, with the keys of this profile poured into its queues.
 *
 * The frame's extras go either side of the pack's own keys: what an eye or
 * a hand wants whatever pack is playing ahead of them, the rest behind.
 * The Rules key takes no queue here: every framed profile has it on the
 * utility page, where it opens whatever pack the run is of.
 */
function zonesFor(frame: Frame, keyed: Keyed | null): Zones {
  const own = keyed ? queuesFor(keyed) : { numbers: [], setups: [], moves: [] };
  const queues = Object.fromEntries(
    POOLS.map((pool) => [pool, [...frame.extras[pool].first, ...own[pool], ...frame.extras[pool].last]]),
  ) as Queues;
  return { frame, queues };
}

/**
 * The profiles for one pack, one per deck, or just the deck named.
 *
 * The slug a profile takes here is the pack's own id, which is what a
 * download from a pack's page is named after; the shipped forty-four are
 * written under the short slugs their files are named by, so
 * `design/profiles.mjs` puts its own slug on each spec before building.
 */
export function specs(pack: Pack | null, setups: Handed[], device?: DeviceId): ProfileSpec[] {
  return specsFor(pack && fromPack(pack, setups), pack ? { slug: pack.id, name: pack.title } : GENERIC, device);
}
