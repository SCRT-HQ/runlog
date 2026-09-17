/**
 * The profiles the plugin ships: a deck laid out before anybody touches it.
 *
 * Forty-four `.streamDeckProfile` files, eleven layouts across four decks.
 * One is generic, the keys any run wants whatever pack it is playing, and
 * the rest are written against a pack. The laying out is
 * `@runlog/deck-profiles`, which is the same code a pack's Marketplace page
 * runs in the browser for a pack the plugin never shipped a profile for;
 * what is left here is the part that needs a filesystem. Nothing is typed
 * in either: the ids come out of the pack files through the same loader the
 * app and the CLI use, so a renamed move changes the profile on the next
 * run of this script rather than going quietly dead on somebody's deck.
 *
 * `npm run profiles -w streamdeck`. It also writes the two tables the
 * plugin reads at run time: `src/profiles.ts`, which turns a run's pack
 * into the profile to switch a deck to, and `src/setups.ts`, which is the
 * setups each pack's tool ships so a profile built from a pack file carries
 * the same keys as one built from a run.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEVICES, container, profile, specs } from "@runlog/deck-profiles";
import { loadPackText, loadSetupText } from "@runlog/rules-schema";
import { format, resolveConfig } from "prettier";

import { DEMO, SKETCHES, SLUGS } from "./layouts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "com.scrthq.runlog.sdPlugin");
const repo = join(here, "..", "..");

/** Our own manifest, for the profile list this checks itself against. */
const MANIFEST = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));

/** The tool a pack is driven by, from the shipped control profile written for it. */
export function toolFor(packId) {
  const dir = join(repo, "packs", "profiles");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    // Read as JSON rather than through the app's reader: that one wants the
    // tool's operation catalog to say anything useful, and all this needs is
    // two fields that `apps/web/src/control/shipped.test.ts` already holds
    // every one of these files to.
    const written = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (written.pack === packId) return written.tool;
  }
  return undefined;
}

/** Every setup written for a tool, by title, the way the app's picker lists them. */
export function setupsFor(tool) {
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

  const out = [{ slug: "runlog", pack: null }];
  for (const { slug, file } of [DEMO, ...sketches]) {
    const parsed = loadPackText(readFileSync(join(repo, file), "utf8"), "yaml");
    if (!parsed.ok) continue;
    out.push({ slug, pack: parsed.pack });
  }
  return out;
}

/**
 * The forty-four profiles, named and keyed, ready to be laid out on a grid.
 *
 * The slug is put on here rather than taken from the package: a profile
 * built in the browser is named after the pack's id, and these are named
 * after the file each pack is kept in, which is what they have shipped
 * under since before the Marketplace had any say in it.
 *
 * The name is not put on here. `specs` marks a pack's profile
 * `<title> (Runlog)` itself, so every profile Runlog makes is named the
 * same way and this script says nothing about it.
 */
export function profileSpecs() {
  const out = [];
  for (const layout of layouts()) {
    for (const spec of specs(layout.pack, setupsFor(layout.pack ? toolFor(layout.pack.id) : undefined))) {
      out.push({ ...spec, slug: layout.slug });
    }
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

/**
 * The setups shipped for each pack's tool, as a module the plugin can import.
 *
 * A profile built from a pack file rather than from a run has no offer to
 * read the setups off, and the pack file names none: a setup is written for
 * a tool, not for a pack. So the same list the shipped profiles are laid
 * out from is written out here too, and the two paths lay out one deck.
 *
 * Cut down to what a key needs. The id and the title name it; the
 * operations are kept by name alone, and only one of each name, because
 * the one thing read off them is whether a `warp.` is in there.
 *
 * Run through the formatter rather than spaced by hand: a setup with a
 * dozen operations is a line the formatter would break, and a generated
 * file that does not come out of the generator formatted is one the format
 * check fails on.
 */
export async function setupsTable(list = layouts()) {
  const packs = [];
  for (const layout of list) {
    if (!layout.pack) continue;
    const setups = setupsFor(toolFor(layout.pack.id));
    if (setups.length === 0) continue;
    const rows = setups.map((s) => {
      const ops = [...new Set(s.ops.map((o) => o.op))].map((op) => `{ op: ${JSON.stringify(op)} }`);
      return `    { id: ${JSON.stringify(s.id)}, title: ${JSON.stringify(s.title)}, ops: [${ops.join(", ")}] },`;
    });
    packs.push(`  ${JSON.stringify(layout.pack.id)}: [\n${rows.join("\n")}\n  ],`);
  }

  const text = `/**
 * The setups shipped for each pack's tool, for a profile built without a run.
 *
 * Written by \`design/profiles.mjs\`: run \`npm run profiles -w streamdeck\`
 * and commit what moves. Edit the setups under \`packs/setups\`, not this
 * file.
 *
 * Only what a key is named from and the operations by name, which is all it
 * takes to tell a warp from a setup. A pack whose tool ships no setups, and
 * a pack that names no tool at all, is not in here.
 */

/** The shipped setups for each pack, by pack id. */
export const PACK_SETUPS: Record<string, Array<{ id: string; title: string; ops: Array<{ op: string }> }>> = {
${packs.join("\n")}
};
`;

  const file = join(here, "..", "src", "setups.ts");
  return await format(text, { ...(await resolveConfig(file)), filepath: file });
}

async function main() {
  const dir = join(plugin, "profiles");
  mkdirSync(dir, { recursive: true });

  const written = [];
  for (const spec of profileSpecs()) {
    const file = `${spec.slug}-${spec.device}`;
    writeFileSync(join(dir, `${file}.streamDeckProfile`), container(profile(spec)));
    // The generic four come with the plugin; a pack's four are installed the
    // first time a deck follows a run of that pack.
    written.push({ name: `profiles/${file}`, type: DEVICES[spec.device].type, auto: spec.slug === "runlog" });
  }

  writeFileSync(join(here, "..", "src", "profiles.ts"), table());
  writeFileSync(join(here, "..", "src", "setups.ts"), await setupsTable());

  // The manifest is edited by hand - a generator that rewrites it fights the
  // formatter over every other line - so the one thing checked here is that
  // it still lists what was just written, in the same order.
  const listed = (MANIFEST.Profiles ?? []).map((p) => `${p.Name}:${p.DeviceType}:${p.AutoInstall}`).join(" ");
  const expected = written.map((p) => `${p.name}:${p.type}:${p.auto}`).join(" ");
  if (listed !== expected) throw new Error(`manifest.json lists\n  ${listed}\nbut this wrote\n  ${expected}`);

  console.log(`${written.length} profiles written to ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
