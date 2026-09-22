// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { loadPackText, parseDice } from "@runlog/rules-schema";
import { memoryRunStore, type RunStore } from "./store.ts";
import { useRun } from "./useRun.ts";

/**
 * How long a run says it is meant to run, worked out once at `startRun` and
 * carried on the very first event, so a watcher or a deck can read how far
 * through the run is.
 *
 * The demo pack's modes cover every shape a mode's `units` can take: `short`
 * fixes it, `shared` rolls it (and is the one mode marked `seeded`, so a
 * seed is required), `standard` only bounds it, and `pairs` never says.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;

afterEach(cleanup);

async function openRun() {
  const store: RunStore = memoryRunStore();
  const hook = renderHook(() => useRun(kiln, store));
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
  return hook;
}

describe("a run's planned length", () => {
  it("is the fixed count, for a mode that fixes it", async () => {
    const hook = await openRun();
    act(() => {
      hook.result.current.startRun("short", "");
    });
    await waitFor(() => expect(hook.result.current.state?.plannedUnits).not.toBeNull());
    expect(hook.result.current.state?.plannedUnits).toBe(5);
  });

  it("is a number inside the dice's range, and the same number twice from the same seed, for a mode that rolls it", async () => {
    const { min, max } = parseDice(kiln.modes.shared!.units!.roll!);

    const first = await openRun();
    act(() => {
      first.result.current.startRun("shared", "loadout-seed");
    });
    await waitFor(() => expect(first.result.current.state?.plannedUnits).not.toBeNull());
    const rolled = first.result.current.state!.plannedUnits!;
    expect(rolled).toBeGreaterThanOrEqual(min);
    expect(rolled).toBeLessThanOrEqual(max);

    const second = await openRun();
    act(() => {
      second.result.current.startRun("shared", "loadout-seed");
    });
    await waitFor(() => expect(second.result.current.state?.plannedUnits).not.toBeNull());
    expect(second.result.current.state?.plannedUnits).toBe(rolled);
  });

  it("is the most a min/max mode allows, when nothing fixes or rolls it", async () => {
    const hook = await openRun();
    act(() => {
      hook.result.current.startRun("standard", "");
    });
    await waitFor(() => expect(hook.result.current.runId).not.toBeNull());
    expect(hook.result.current.state?.plannedUnits).toBe(kiln.modes.standard!.units!.max);
  });

  it("is null for a mode that never says how long it runs", async () => {
    const hook = await openRun();
    act(() => {
      hook.result.current.startRun("pairs", "");
    });
    await waitFor(() => expect(hook.result.current.runId).not.toBeNull());
    expect(hook.result.current.state?.plannedUnits).toBeNull();
  });

  describe("the streamer's own pick, for a mode that only bounds its length", () => {
    it("is recorded, when it falls inside the mode's range", async () => {
      const hook = await openRun();
      act(() => {
        hook.result.current.startRun("standard", "", 1, "", [], [], { plannedUnits: 8 });
      });
      await waitFor(() => expect(hook.result.current.runId).not.toBeNull());
      expect(hook.result.current.state?.plannedUnits).toBe(8);
    });

    it("gives way to the max, when the pick is outside the range", async () => {
      const hook = await openRun();
      act(() => {
        hook.result.current.startRun("standard", "", 1, "", [], [], { plannedUnits: 99 });
      });
      await waitFor(() => expect(hook.result.current.runId).not.toBeNull());
      expect(hook.result.current.state?.plannedUnits).toBe(kiln.modes.standard!.units!.max);
    });

    it("is ignored for a mode that fixes its length", async () => {
      const hook = await openRun();
      act(() => {
        hook.result.current.startRun("short", "", 1, "", [], [], { plannedUnits: 8 });
      });
      await waitFor(() => expect(hook.result.current.runId).not.toBeNull());
      expect(hook.result.current.state?.plannedUnits).toBe(5);
    });
  });
});
