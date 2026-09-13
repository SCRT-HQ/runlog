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
  ({ runId: "r1", packId: tarnished.id, packVersion: tarnished.version, events: [], updatedAt: "", role: "owner", ...(control !== undefined ? { control } : {}) }) as StoredRun;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("a run that has never had a profile", () => {
  it("takes the one its pack ships with, without being asked", async () => {
    const onControl = vi.fn();
    render(<ControlSettings pack={tarnished} record={record()} onControl={onControl} />);
    await waitFor(() => expect(onControl).toHaveBeenCalled());
    const given = onControl.mock.calls[0]![0] as { rows?: unknown[]; tool?: string };
    expect(given.tool).toBe("TarnishedTool");
    expect(given.rows?.length ?? 0).toBeGreaterThan(100);
    // And the offer to load it is gone, because it is loaded.
    expect(screen.queryByText(/Use the one that ships with/)).toBeNull();
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

  it("says what is missing rather than leaving a placeholder unexplained", () => {
    render(<ControlSettings pack={tarnished} record={record({})} />);
    expect(screen.getByText(/ws:\/\/|wss:\/\//).textContent).toContain("REPLACE-WITH-YOUR-WATCH-KEY");
    expect(screen.getByText(/once it has a key/)).toBeTruthy();
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
