/**
 * The profiles the plugin ships: a deck laid out before anybody touches it.
 *
 * Forty-four `.streamDeckProfile` files, eleven layouts across four decks.
 * One is generic - the keys any run wants, whatever pack it is playing -
 * and the rest are written against a pack, with its moves on keys, its
 * counters and resources on the numbers, and the setups for its tool ready
 * to hand out. Nothing is typed in here: the ids come out of the pack files
 * through the same loader the app and the CLI use, so a renamed move
 * changes the profile on the next run of this script rather than going
 * quietly dead on somebody's deck.
 *
 * `npm run profiles -w streamdeck`. It also writes `src/profiles.ts`, which
 * is the one thing here the plugin reads at run time: the table that turns a
 * run's pack into the profile to switch a deck to.
 *
 * The container is a zip whose single top-level entry is a
 * `<UUID>.sdProfile/` folder. That is not documented anywhere; it is what
 * the Stream Deck app's own `DefaultProfiles` and the profiles bundled with
 * Elgato's Volume Controller plugin turn out to be, and the writer below
 * matches them entry for entry.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPackText, loadSetupText } from "@runlog/rules-schema";

import { BASE, DEMO, DEVICES, DIALS, SKETCHES, SLUGS } from "./layouts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "com.scrthq.runlog.sdPlugin");
const repo = join(here, "..", "..");

/** Our own manifest, so an action's `Name` and the plugin version are never retyped. */
const MANIFEST = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));

/** The action `Name` the app expects beside each of our UUIDs. */
const NAMES = Object.fromEntries(MANIFEST.Actions.map((a) => [a.UUID, a.Name]));

/** The plugin block every one of our actions carries. */
const PLUGIN = { Name: MANIFEST.Name, UUID: MANIFEST.UUID, Version: MANIFEST.Version };

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

/** The app's own page turns, which are not ours and take none of our furniture. */
const PAGE_PLUGIN = { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" };
const TURNS = {
  next: { Name: "Next Page", UUID: "com.elgato.streamdeck.page.next" },
  previous: { Name: "Previous Page", UUID: "com.elgato.streamdeck.page.previous" },
};

/**
 * Stable ids, so regenerating a profile is not a diff.
 *
 * A profile folder, its pages and every action on them want a UUID, and the
 * app does not care where they came from as long as they are unique. Random
 * ones would rewrite all twelve files on every run and bury a real change in
 * the churn, so each is derived from what it is - the same name in, the same
 * UUID out. Version 5 in shape, off a namespace of our own.
 */
const NAMESPACE = createHash("sha1").update("com.scrthq.runlog.profiles").digest().subarray(0, 16);

export function stableId(name) {
  const h = createHash("sha1").update(NAMESPACE).update(name, "utf8").digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.subarray(0, 16).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * One key, as the app stores it.
 *
 * `LinkedTitle` true is what lets the plugin's own title survive a copy of
 * the key to another slot, and `State: 0` with a single `States` entry is
 * every one of our actions: none of them has a second state.
 */
function entry(id, spec) {
  const uuid = `${MANIFEST.UUID}.${spec.action}`;
  return {
    ActionID: id,
    LinkedTitle: true,
    Name: NAMES[uuid],
    Plugin: PLUGIN,
    Resources: null,
    Settings: spec.settings ?? {},
    State: 0,
    States: [STATE],
    UUID: uuid,
  };
}

/** A page turn, which carries the app's plugin block and an empty face. */
function turn(id, which) {
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
 * The keys a pack adds to the generic fourteen.
 *
 * Its moves first, because those are what somebody presses; then the
 * numbers it keeps; then the setups for whatever tool it is driven by.
 *
 * A hidden counter is left out. `packages/engine/src/snapshot.ts` does not
 * publish one, so a key set to it would say nothing for ever - and hidden
 * is the pack saying it is bookkeeping rather than a number to watch.
 *
 * The setups are the tool's, not the pack's: a setup names a tool and no
 * pack at all, which is `forTool` in `apps/web/src/control/setups.ts`, and
 * they are ordered by title the way the app's own picker orders them. A
 * pack with no shipped control profile names no tool and gets none.
 *
 * Last, a key that opens the pack's rules in the browser: a pack profile
 * is the one place that key has a pack to open.
 */
export function packKeys(pack, setups) {
  const keys = [];
  for (const id of Object.keys(pack.moves ?? {})) keys.push({ action: "press", settings: { target: { kind: "move", id } } });
  for (const [id, counter] of Object.entries(pack.counters ?? {})) {
    if (!counter.hidden) keys.push({ action: "metric", settings: { field: { counter: id } } });
  }
  for (const id of Object.keys(pack.resources ?? {})) keys.push({ action: "metric", settings: { field: { resource: id } } });
  for (const setup of setups) keys.push({ action: "setup", settings: { setup: { id: setup.id, title: setup.title } } });
  keys.push({ action: "open", settings: { target: "rules" } });
  return keys;
}

/**
 * The keys cut into pages, with room kept for the turns.
 *
 * Every page after the first spends its first position on a way back, and
 * every page with more behind it spends its last on a way on. The last page
 * spends neither, so a layout that fits exactly does not grow a turn key
 * pointing at nothing.
 */
export function paginate(keys, capacity) {
  const pages = [];
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
const at = (slot, columns) => `${slot % columns},${Math.floor(slot / columns)}`;

/**
 * One profile, as a set of files, before anything is zipped.
 *
 * `ids` is handed in so a test can run the whole thing on a counter and
 * compare what came out; the default derives them from the profile's own
 * name and is what the committed files are built with.
 */
export function profile({ slug, device, name, keys }, ids = stableId) {
  const { model, columns, rows, dials } = DEVICES[device];
  const capacity = columns * rows;
  const cut = paginate(keys, capacity);

  const files = {};
  const pageIds = [];
  for (const [index, page] of cut.entries()) {
    const id = ids(`${slug}/${device}/page/${index}`).toUpperCase();
    pageIds.push(id);

    const actions = {};
    if (page.back) actions[at(0, columns)] = turn(ids(`${slug}/${device}/page/${index}/back`), "previous");
    for (const [n, key] of page.keys.entries()) {
      const slot = (page.back ? 1 : 0) + n;
      actions[at(slot, columns)] = entry(ids(`${slug}/${device}/page/${index}/key/${n}`), key);
    }
    if (page.more) actions[at(capacity - 1, columns)] = turn(ids(`${slug}/${device}/page/${index}/more`), "next");

    const controllers = [{ Type: "Keypad", Actions: actions }];
    if (dials > 0) {
      const wheel = {};
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
    // profile we ship goes to everybody's.
    Device: { Model: model, UUID: "" },
    Name: name,
    Pages: {
      Current: pageIds[0].toLowerCase(),
      Default: empty.toLowerCase(),
      Pages: pageIds.map((id) => id.toLowerCase()),
    },
    Version: "3.0",
  };

  return { folder: `${ids(`${slug}/${device}`).toUpperCase()}.sdProfile`, files };
}

/* -------------------------------------------------------------------- */
/* The container                                                         */
/* -------------------------------------------------------------------- */

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * A stored-only zip, written here rather than pulled in.
 *
 * Nothing in the repository zips anything else, and the alternative is a
 * dependency for two hundred lines of header. Stored rather than deflated
 * because a profile is a few kilobytes of JSON and the app reads either;
 * every timestamp is the same fixed one, so running this twice produces the
 * same bytes twice and the committed files only move when a layout does.
 */
export function zip(entries) {
  const DOS_DATE = 33; // 1980-01-01, the earliest a zip can say.
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const label = Buffer.from(name, "utf8");
    const body = data ?? Buffer.alloc(0);
    const sum = crc32(body);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 6);
    head.writeUInt16LE(0, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(sum, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(body.length, 22);
    head.writeUInt16LE(label.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, label, body);

    const listed = Buffer.alloc(46);
    listed.writeUInt32LE(0x02014b50, 0);
    listed.writeUInt16LE(20, 4);
    listed.writeUInt16LE(20, 6);
    listed.writeUInt16LE(0, 8);
    listed.writeUInt16LE(0, 10);
    listed.writeUInt16LE(0, 12);
    listed.writeUInt16LE(DOS_DATE, 14);
    listed.writeUInt32LE(sum, 16);
    listed.writeUInt32LE(body.length, 20);
    listed.writeUInt32LE(body.length, 24);
    listed.writeUInt16LE(label.length, 28);
    listed.writeUInt16LE(0, 30);
    listed.writeUInt16LE(0, 32);
    listed.writeUInt16LE(0, 34);
    listed.writeUInt16LE(0, 36);
    // The directory bit, so an unpacker makes the folder rather than a file.
    listed.writeUInt32LE(name.endsWith("/") ? 0x10 : 0, 38);
    listed.writeUInt32LE(offset, 42);
    central.push(listed, label);

    offset += head.length + label.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** A built profile as the bytes of a `.streamDeckProfile`, folders and all. */
export function container({ folder, files }) {
  const entries = [{ name: `${folder}/` }];
  const folders = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  }
  for (const dir of [...folders].sort()) entries.push({ name: `${folder}/${dir}/` });
  for (const [path, body] of Object.entries(files)) {
    entries.push({ name: `${folder}/${path}`, data: Buffer.from(JSON.stringify(body), "utf8") });
  }
  return zip(entries);
}

/* -------------------------------------------------------------------- */
/* What goes in them                                                     */
/* -------------------------------------------------------------------- */

/** The tool a pack is driven by, from the shipped control profile written for it. */
function toolFor(packId) {
  const dir = join(repo, "packs", "profiles");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    // Read as JSON rather than through the app's reader: that one wants the
    // tool's operation catalog to say anything useful, and all this needs is
    // two fields that `apps/web/src/control/shipped.test.ts` already holds
    // every one of these files to.
    const profile = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (profile.pack === packId) return profile.tool;
  }
  return undefined;
}

/** Every setup written for a tool, by title, the way the app's picker lists them. */
function setupsFor(tool) {
  if (!tool) return [];
  const dir = join(repo, "packs", "setups");
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const parsed = loadSetupText(readFileSync(join(dir, file), "utf8"), "yaml");
    if (parsed.ok && parsed.setup.tool.toLowerCase() === tool.toLowerCase()) out.push(parsed.setup);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The layouts, in the order the manifest lists them: generic, demo, sketches.
 *
 * Every pack that ships gets one. Forty profiles auto-installing on a deck
 * would be forty entries in somebody's profile list on the day they install
 * the plugin, so a pack's four wait in the package and the plugin asks for
 * the one it needs; `main` writes the table it asks through.
 *
 * A sketch that no longer parses is left out rather than throwing. It is a
 * file in the repository with its own tests, and a broken one should fail
 * there rather than stop every other profile being written.
 */
export function layouts() {
  const sketches = readdirSync(join(repo, SKETCHES))
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => ({ slug: SLUGS[basename(f, ".yaml")] ?? basename(f, ".yaml"), file: `${SKETCHES}/${f}` }));

  const out = [{ slug: "runlog", name: "Runlog", pack: null }];
  for (const { slug, file } of [DEMO, ...sketches]) {
    const parsed = loadPackText(readFileSync(join(repo, file), "utf8"), "yaml");
    if (!parsed.ok) continue;
    // The pack's own title, and nothing else: the Stream Deck app already
    // says which plugin a profile came with.
    out.push({ slug, name: parsed.pack.title, pack: parsed.pack });
  }
  return out;
}

/** The forty-four profiles, named and keyed, ready to be laid out on a grid. */
export function specs() {
  const out = [];
  for (const layout of layouts()) {
    const keys = layout.pack ? [...BASE, ...packKeys(layout.pack, setupsFor(toolFor(layout.pack.id)))] : BASE;
    for (const device of Object.keys(DEVICES)) out.push({ slug: layout.slug, device, name: layout.name, keys });
  }
  return out;
}

/**
 * The table the plugin switches through, as a module it can import.
 *
 * The plugin never spells a profile name out. A pack renamed here, or a
 * sketch added to the repository, moves this file on the next run of the
 * generator, and the two stay one thing rather than two lists that drift.
 */
export function table(list = layouts()) {
  const packs = list.filter((l) => l.pack).map((l) => `  "${l.pack.id}": "${l.slug}",`);
  const decks = Object.entries(DEVICES).map(([device, { type }]) => `  ${type}: "${device}",`);
  return `/**
 * Which profile a run's pack is laid out in, and what each deck is called.
 *
 * Written by \`design/profiles.mjs\`: run \`npm run profiles -w streamdeck\`
 * and commit what moves. Editing it by hand renames a profile the plugin
 * asks for without renaming the file behind it, and the switch then does
 * nothing at all.
 */

/** The slug of the profile laid out for each pack the plugin ships. */
export const PACK_PROFILES: Record<string, string> = {
${packs.join("\n")}
};

/** What a profile name calls each deck, by the SDK's \`DeviceType\`. */
export const DEVICE_PROFILES: Record<number, string> = {
${decks.join("\n")}
};

/** The layout a run gets where its pack ships none, which is every Marketplace pack. */
export const GENERIC_PROFILE = "runlog";

/**
 * The profile to put a deck on for a run of this pack.
 *
 * \`null\` for a deck nothing here is laid out for - a Pedal, a Neo - which is
 * a deck to leave alone rather than one to push the generic layout onto.
 */
export function profileFor(packId: string | undefined, device: number): string | null {
  const deck = DEVICE_PROFILES[device];
  if (deck === undefined) return null;
  const slug = (packId === undefined ? undefined : PACK_PROFILES[packId]) ?? GENERIC_PROFILE;
  return \`profiles/\${slug}-\${deck}\`;
}
`;
}

function main() {
  const dir = join(plugin, "profiles");
  mkdirSync(dir, { recursive: true });

  const written = [];
  for (const spec of specs()) {
    const file = `${spec.slug}-${spec.device}`;
    writeFileSync(join(dir, `${file}.streamDeckProfile`), container(profile(spec)));
    // The generic four come with the plugin; a pack's four are installed the
    // first time a deck follows a run of that pack.
    written.push({ name: `profiles/${file}`, type: DEVICES[spec.device].type, auto: spec.slug === "runlog" });
  }

  writeFileSync(join(here, "..", "src", "profiles.ts"), table());

  // The manifest is edited by hand - a generator that rewrites it fights the
  // formatter over every other line - so the one thing checked here is that
  // it still lists what was just written, in the same order.
  const listed = (MANIFEST.Profiles ?? []).map((p) => `${p.Name}:${p.DeviceType}:${p.AutoInstall}`).join(" ");
  const expected = written.map((p) => `${p.name}:${p.type}:${p.auto}`).join(" ");
  if (listed !== expected) throw new Error(`manifest.json lists\n  ${listed}\nbut this wrote\n  ${expected}`);

  console.log(`${written.length} profiles written to ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
