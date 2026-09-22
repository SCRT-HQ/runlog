// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { StoredRun } from "../storage/db.ts";
import { ControlSettings } from "./ControlSettings.tsx";

/**
 * The two things the panel now does without being asked: take the
 * profile the pack ships with, and remember the key that finishes the
 * address. Both are about a run that should work when somebody opens
 * it rather than after they find two buttons.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/sketches/elden-ring-tarnishedtool.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the TarnishedTool pack did not load");
const tarnished = loaded.pack;

const record = (control?: unknown): StoredRun =>
  ({
    runId: "r1",
    packId: tarnished.id,
    packVersion: tarnished.version,
    events: [],
    updatedAt: "",
    role: "owner",
    ...(control !== undefined ? { control } : {}),
  }) as StoredRun;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("a run that has never had a profile", () => {
  /*
   * Twenty seconds, for a test that takes two: it reads the shipped
   * TarnishedTool profile, which is a hundred and some rows through a
   * raw glob, and the default five were close enough to the real number
   * that a slower machine failed on the arithmetic rather than on
   * anything the panel did.
   */
  it("takes the one its pack ships with, without being asked", { timeout: 20000 }, async () => {
    const onControl = vi.fn();
    render(<ControlSettings pack={tarnished} record={record()} onControl={onControl} />);
    await waitFor(() => expect(onControl).toHaveBeenCalled());
    const given = onControl.mock.calls[0]![0] as { rows?: unknown[]; tool?: string };
    expect(given.tool).toBe("TarnishedTool");
    expect(given.rows?.length ?? 0).toBeGreaterThan(100);
    // And the offer to load it is gone, because it is loaded.
    expect(screen.queryByText(/Use the one that ships with/)).toBeNull();
  });

  /*
   * The shipped profile has fifty-odd loadout rows, and each one names
   * items, weapons, ashes and a grace. When every rule's editor drew its
   * own copy of those lists, the page held the tool's two and a half
   * thousand names fifty times over, and a machine slower than this one
   * ran out of patience before the panel had drawn. The sheet draws each
   * list once and every field points at that one.
   */
  it("draws each of the tool's lists once for the whole sheet, however many rules use it", { timeout: 20000 }, async () => {
    const onControl = vi.fn();
    const { container } = render(<ControlSettings pack={tarnished} record={record()} onControl={onControl} />);
    await waitFor(() => expect(onControl).toHaveBeenCalled());
    const drawn = [...container.querySelectorAll("datalist")].map((d) => d.id.replace(/^.*-/, ""));
    expect(drawn.filter((name) => name === "items")).toHaveLength(1);
    expect(drawn.filter((name) => name === "graces")).toHaveLength(1);
    // And a field still finds the one copy.
    const fields = [...container.querySelectorAll('input[list$="-items"]')];
    expect(fields.length).toBeGreaterThan(1);
    expect(container.querySelector(`datalist[id="${fields[0]!.getAttribute("list")}"]`)).not.toBeNull();
  });

  it("still offers it as a way back once somebody has emptied the rules", async () => {
    const onControl = vi.fn();
    render(<ControlSettings pack={tarnished} record={record({})} onControl={onControl} />);
    await waitFor(() => expect(screen.getByText(/Use the one that ships with/)).toBeTruthy());
    // An emptied profile is not a missing one: nothing was handed back.
    expect(onControl).not.toHaveBeenCalled();
  });

  it("leaves a profile somebody wrote alone", async () => {
    const onControl = vi.fn();
    const mine = { tool: "TarnishedTool", rows: [{ tag: "setback", ops: [{ op: "player.drop", args: { height: 150 } }] }] };
    render(<ControlSettings pack={tarnished} record={record(mine)} onControl={onControl} />);
    await waitFor(() => expect(screen.queryByText(/ships with a profile/)).toBeNull());
    expect(onControl).not.toHaveBeenCalled();
  });
});

describe("the address the tool dials", () => {
  it("is finished from the key this device made, on a later visit", () => {
    localStorage.setItem("runlog:watchKey", "a-remembered-key");
    render(<ControlSettings pack={tarnished} record={record({})} />);
    expect(screen.getByText(/ws:\/\/|wss:\/\//).textContent).toContain("k=a-remembered-key");
  });

  it("says what is missing rather than offering an address nobody can use", () => {
    /*
     * It printed the address with REPLACE-WITH-YOUR-WATCH-KEY where the
     * key goes, in the box a finished one appears in, with Copy beside
     * it. The words were always right; the thing above them was not.
     */
    render(<ControlSettings pack={tarnished} record={record({})} />);
    expect(screen.queryByText(/ws:\/\/|wss:\/\//)).toBeNull();
    expect(screen.getByText(/once it has a key/)).toBeTruthy();
  });

  it("says it is loading while the run is finding a key", () => {
    // Not unfinished: unfinished yet. The run mints one on open, and
    // until it answers there is nothing to print and nothing wrong.
    render(<ControlSettings pack={tarnished} record={record({})} reachable={{ link: null, key: null, working: true }} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/ws:\/\/|wss:\/\//)).toBeNull();
  });

  it("takes the key the run minted, rather than asking for one of its own", () => {
    // The run mints on open and remembers; this panel used to keep its
    // own answer, so the two could disagree and the panel's was the one
    // on screen -- with the server saying a key exists and the device
    // unable to name it, which no button could resolve but Make one.
    render(<ControlSettings pack={tarnished} record={record({})} reachable={{ link: null, key: "from-the-run", working: false }} />);
    expect(screen.getByText(/ws:\/\/|wss:\/\//).textContent).toContain("k=from-the-run");
  });

  it("attaches as a watcher, which is the only thing this key is for", () => {
    localStorage.setItem("runlog:watchKey", "a-remembered-key");
    const address = render(<ControlSettings pack={tarnished} record={record({})} />).container.querySelector(".askAddress")!.textContent!;
    expect(address).toContain("as=control");
    // The other key of the pair is a bot's and belongs nowhere near an
    // address that goes into a tool on a streaming machine.
    expect(address).not.toContain("press");
  });
});
