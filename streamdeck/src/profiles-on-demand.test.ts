import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { fromPack, profile, specsFor, type Handed } from "@runlog/deck-profiles";
import { loadPackText, loadSetupText } from "@runlog/rules-schema";

import { remember } from "./seen.ts";
import { PACK_SETUPS } from "./setups.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The setups on disk for a tool, the way `design/profiles.mjs` reads them
 * for the profiles in the package.
 *
 * Read again here rather than imported from the generator: that script is
 * plain JavaScript with no types for this side to compile against. It is
 * the same two folders and the same order, which is what makes the shipped
 * layout something this can hold the Install key's build against.
 */
function shippedSetups(packId: string): Handed[] {
  const profiles = join(repo, "packs", "profiles");
  let tool: string | undefined;
  for (const file of readdirSync(profiles).filter((f) => f.endsWith(".json"))) {
    const written = JSON.parse(readFileSync(join(profiles, file), "utf8")) as { pack?: string; tool?: string };
    // The first match, the way the generator's own `toolFor` takes it: two
    // control profiles for one pack would otherwise be read differently
    // here and there, and the comparison below would be of two packs.
    if (written.pack === packId) {
      tool = written.tool;
      break;
    }
  }
  if (!tool) return [];
  const dir = join(repo, "packs", "setups");
  const out: Handed[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const parsed = loadSetupText(readFileSync(join(dir, file), "utf8"), "yaml");
    if (parsed.ok && parsed.setup.tool.toLowerCase() === tool.toLowerCase()) out.push(parsed.setup);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Building a profile for the pack the deck is following, from the run.
 *
 * The filesystem is faked, so nothing here writes beside the plugin, and
 * the SDK with it: `install` reaches the operating system's own opener,
 * which on a real desk is the Stream Deck app's import prompt. What the
 * layout comes out as is `packages/deck-profiles` and is tested there;
 * what is checked here is the part that only this side has, which is the
 * file it lands in and the URL it goes out as.
 */
const mock = vi.hoisted(() => ({
  opened: [] as string[],
  made: [] as string[],
  wrote: [] as Array<{ file: string; bytes: Uint8Array }>,
  logged: [] as string[],
}));
vi.mock("@elgato/streamdeck", () => ({
  default: {
    system: {
      openUrl: (url: string) => {
        mock.opened.push(url);
      },
    },
    logger: {
      info: (line: string) => {
        mock.logged.push(line);
      },
    },
  },
}));
// Reading stays real: the pack this compares the two paths on is a file in
// the repository. Only the two calls that write beside the plugin are held.
vi.mock("node:fs", async (orig) => ({
  ...(await orig<typeof import("node:fs")>()),
  mkdirSync: (dir: string) => {
    mock.made.push(dir);
  },
  writeFileSync: (file: string, bytes: Uint8Array) => {
    mock.wrote.push({ file, bytes });
  },
}));

const { buildFor, buildForPack, install, keyedForPack, slugFor } = await import("./profiles-on-demand.ts");

/** A run of a pack the plugin ships no profile for, with an offer to lay out. */
const state = (run: { packId?: string; packTitle?: string } | null) =>
  ({
    snapshot: run
      ? {
          run: { id: "r1", ...run },
          offer: {
            seq: 3,
            primary: null,
            moves: [
              { id: "push-on", label: "Push on" },
              { id: "hold", label: "Hold" },
            ],
            undo: null,
            needsPage: null,
            presets: [],
            trackers: [
              { id: "marks", kind: "counter" as const, label: "Marks", value: 2, max: null },
              { id: "stock", kind: "resource" as const, label: "Stock", value: 1, max: 3 },
            ],
            setups: [{ id: "com.example.setups.starter", title: "Starter kit" }],
            commands: [{ id: "com.example.setups.starter", title: "Starter kit" }],
          },
        }
      : null,
  }) as never;

describe("a profile built from the run the deck is on", () => {
  it("writes it beside the plugin, named for the pack and the deck", () => {
    mock.wrote = [];
    mock.made = [];
    const built = buildFor(state({ packId: "com.example.ember-trail", packTitle: "Ember Trail" }), 2)!;

    expect(built.file).toContain("com.example.ember-trail-xl.streamDeckProfile");
    // Under the plugin's own folder, which is where the SDK writes its logs
    // and so is writable on both platforms.
    expect(built.file).toContain("on-demand");
    expect(mock.made).toHaveLength(1);
    expect(built.file.startsWith(mock.made[0]!)).toBe(true);

    // A `.streamDeckProfile` is a zip, and what was written is what came back.
    expect([...built.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
    expect(mock.wrote.map((w) => w.file)).toEqual([built.file]);
    expect([...mock.wrote[0]!.bytes]).toEqual([...built.bytes]);
  });

  it("carries the run's own moves and trackers, and the pack's title", () => {
    const built = buildFor(state({ packId: "com.example.ember-trail", packTitle: "Ember Trail" }), 2)!;
    const text = new TextDecoder().decode(built.bytes);
    expect(text).toContain("push-on");
    expect(text).toContain("marks");
    expect(text).toContain("stock");
    expect(text).toContain("com.example.setups.starter");
    // What the Stream Deck app will call it in the streamer's own list.
    expect(text).toContain("Ember Trail");
  });

  it("lays out the pack the snapshot publishes, not the moves the run happens to be offering", () => {
    // The offer is what the step will take right now; the layout is the
    // pack. A move behind a gate that is shut is in the second and not the
    // first, and a profile is of the pack.
    const snapshot = state({ packId: "com.example.ember-trail", packTitle: "Ember Trail" }) as {
      snapshot: { layout?: unknown };
    };
    snapshot.snapshot.layout = {
      moves: [
        { id: "push-on", label: "Push on" },
        { id: "hold", label: "Hold" },
        { id: "make-camp", label: "Make camp" },
      ],
      counters: [{ id: "marks", label: "Marks" }],
      resources: [{ id: "stock", label: "Stock" }],
    };

    const text = new TextDecoder().decode(buildFor(snapshot as never, 2)!.bytes);
    expect(text).toContain("make-camp");
    // And the setups still come off the offer, which is the only place they are.
    expect(text).toContain("com.example.setups.starter");
  });

  it("falls back to the pack's id where the run names no title", () => {
    const built = buildFor(state({ packId: "com.example.ember-trail" }), 2)!;
    expect(new TextDecoder().decode(built.bytes)).toContain("com.example.ember-trail");
  });

  it("lays one out for every deck it has a grid for, and nothing for the rest", () => {
    for (const [device, deck] of [
      [2, "xl"],
      [0, "sd"],
      [1, "mini"],
      [7, "plus"],
    ] as const) {
      expect(buildFor(state({ packId: "com.example.ember-trail" }), device)!.file).toContain(`ember-trail-${deck}`);
    }
    // A Pedal is a deck to leave alone rather than one to push a layout onto.
    expect(buildFor(state({ packId: "com.example.ember-trail" }), 5)).toBe(null);
  });

  it("builds nothing until a snapshot names the pack", () => {
    expect(buildFor(state(null), 2)).toBe(null);
    expect(buildFor(state({}), 2)).toBe(null);
  });

  it("makes a file name out of a pack id, whatever is in it", () => {
    expect(slugFor("com.example.ember-trail")).toBe("com.example.ember-trail");
    expect(slugFor("../../etc/passwd")).toBe("etc-passwd");
    expect(slugFor("a pack/with bits")).toBe("a-pack-with-bits");
  });

  it("hands the file to whatever opens a profile, which is the Stream Deck app", () => {
    mock.opened = [];
    mock.logged = [];
    const built = buildFor(state({ packId: "com.example.ember-trail" }), 2)!;
    install(built.file);

    expect(mock.opened).toHaveLength(1);
    expect(mock.opened[0]!.startsWith("streamdeck://app/openfile/")).toBe(true);
    expect(decodeURIComponent(mock.opened[0]!)).toContain("com.example.ember-trail-xl.streamDeckProfile");
    // One line for the build and one for the hand-over, and no more.
    expect(mock.logged).toHaveLength(2);
  });
});

/**
 * The other path to a profile: the pack file off the account, with no run
 * anywhere. It has to lay out the same deck as the run-based one, which
 * for a pack the plugin ships a profile for means the same deck as the
 * profile in the package.
 */
describe("a profile built from the pack file", () => {
  const sketch = join(repo, "packs", "sketches", "elden-ring-tarnishedtool.yaml");
  const loaded = loadPackText(readFileSync(sketch, "utf8"), "yaml");
  const pack = loaded.ok ? loaded.pack : null;

  it("lays out the same keys as the profile the plugin ships for the same pack", () => {
    // Page for page rather than byte for byte: the shipped one is named
    // and seeded by the slug its file has shipped under and this one by
    // the pack's id, so the two are built under one name here and what is
    // left is the keys.
    const named = { slug: "elden-ring", name: pack!.title };
    const shipped = profile(specsFor(fromPack(pack!, shippedSetups(pack!.id)), named, "xl")[0]!);
    const built = profile(specsFor(keyedForPack(pack!), named, "xl")[0]!);
    expect(built).toEqual(shipped);
  });

  it("carries the Apply setup and Command keys, which is the whole of the difference", () => {
    const keyed = keyedForPack(pack!);
    expect(keyed.setups.map((s) => s.id)).toContain("com.scrthq.runlog.setups.bare-handed");
    // Start of the DLC warps the player, so it is a Command key. The table
    // keeps the operation names for exactly this.
    expect(keyed.commands.map((s) => s.id)).toEqual(["com.scrthq.runlog.setups.start-of-the-dlc"]);
  });

  it("takes the setups the deck saw on a run for a pack that ships none", () => {
    const id = "com.example.ember-trail";
    remember(id, [
      { id: "com.example.setups.starter", title: "Starter kit", warp: false },
      { id: "com.example.setups.camp", title: "Back to camp", warp: true },
    ]);
    const keyed = keyedForPack({ id, title: "Ember Trail", moves: { "push-on": {} } } as never);
    expect(keyed.setups.map((s) => s.id)).toEqual(["com.example.setups.starter"]);
    // A remembered warp is a Command key, the way a shipped one is.
    expect(keyed.commands.map((s) => s.id)).toEqual(["com.example.setups.camp"]);
  });

  it("says in the log which of the two sources the setups came from", () => {
    mock.logged = [];
    buildForPack({ id: "com.example.ember-trail", title: "Ember Trail", moves: { "push-on": {} } } as never, 2);
    expect(mock.logged[0]).toBe("profile: com.example.ember-trail setups from the shipped table (0) and the deck's memory (2)");

    mock.logged = [];
    keyedForPack(pack!);
    expect(mock.logged[0]).toBe(
      `profile: ${pack!.id} setups from the shipped table (${PACK_SETUPS[pack!.id]!.length}) and the deck's memory (0)`,
    );
  });
});
