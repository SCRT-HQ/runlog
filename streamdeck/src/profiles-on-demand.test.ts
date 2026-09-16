import { describe, expect, it, vi } from "vitest";

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
vi.mock("node:fs", () => ({
  mkdirSync: (dir: string) => {
    mock.made.push(dir);
  },
  writeFileSync: (file: string, bytes: Uint8Array) => {
    mock.wrote.push({ file, bytes });
  },
}));

const { buildFor, install, slugFor } = await import("./profiles-on-demand.ts");

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
