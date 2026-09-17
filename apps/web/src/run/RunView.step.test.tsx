// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { syncBus } from "../sync/bus.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { memoryRunStore, type RunStore } from "./store.ts";
import { RunView } from "./RunView.tsx";

/**
 * One surface, and the control at the foot of it.
 *
 * The result of a roll used to arrive as a card of its own above the step,
 * which pushed the step and the button the player was about to press down
 * the page by the height of whatever had just been rolled. It is drawn
 * inside the step's own surface now: the same phase line, the same title,
 * the result where the instructions were, and the control at the foot of
 * it reading "Carry on" instead of the step's word.
 *
 * What is pinned is the control's place, not a pixel: it is the last thing
 * in the surface in both states, in the same row, at the same size. The
 * surface takes the height of what it is showing, so a taller result moves
 * the control down with it rather than leaving a hole above it. Where the
 * control lands on the screen is measured in a browser, not here.
 */

vi.mock("../sync/useApi.ts", () => ({ useApi: () => null }));
// The shipped setups and profiles are read from disk on a timer of their
// own, which outlives a test about one card.
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [],
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [],
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

/**
 * The demo pack with one phase in front: a roll, in the first unit.
 *
 * The shipped pack skips its own roll in the first Stage, and walking a
 * log as far as the second is a dozen events of setup for a test about one
 * card. Built here rather than added under `packs/`, so editing a shipped
 * pack cannot break it.
 */
const rolling = {
  ...kiln,
  id: "com.example.rolling",
  unit: { ...kiln.unit, createsSubject: false },
  phases: [
    { id: "check", label: "Kiln Check", steps: [{ kind: "rollTable", table: "check", label: "Roll the Kiln Check" }] },
    { id: "close", label: "Fire", steps: [{ kind: "finalizeUnit", label: "Fire the Stage" }] },
  ],
} as unknown as Pack;

const sync: Sync = {
  available: true,
  enabled: false,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture: () => false,
  drove: () => {},
};

async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  cleanup();
});

const at = "2026-09-14T00:00:00.000Z";

const runId = "run1";
const entered = [
  { id: "e1", t: "RunStarted", at, packId: rolling.id, packVersion: rolling.version, runId, mode },
  { id: "e2", t: "UnitEntered", at },
] as RunEvent[];

/** A run of the fixture pack, one unit in, sitting on the roll. */
async function onTheRoll(role: "owner" | "viewer" = "owner"): Promise<{ container: HTMLElement; store: RunStore }> {
  // A watched run keeps what it is given, because listening for what a sync
  // pass pulled is the only way a result reaches a device that did not roll
  // it. A run played here does not, so the store stays the plain memory one
  // the other tests in this file use.
  const store: RunStore = { ...memoryRunStore(), keeps: role === "viewer" };
  await store.saveRun({
    runId,
    packId: rolling.id,
    packVersion: rolling.version,
    packTitle: rolling.title,
    events: entered,
    updatedAt: at,
    role,
  });
  store.setActiveRunFor(rolling.id, runId);
  const { container } = render(
    <SyncContext.Provider value={sync}>
      <RunView pack={rolling} store={store} bench={role === "owner" ? { from: "test", onLeave: () => {} } : undefined} />
    </SyncContext.Provider>,
  );
  await flush();
  return { container, store };
}

/** The current-action surface, its head, and the control at the foot of it. */
function surface(container: HTMLElement) {
  const wide = container.querySelector(".col.wide")!;
  const step = wide.querySelector<HTMLElement>("section.runStep:not(.entryWords)");
  if (!step) return null;
  const primary = step.querySelector<HTMLButtonElement>(":scope > .stepAction > button.primary.big");
  return {
    step,
    receipt: step.classList.contains("receipt"),
    phase: step.querySelector(":scope > h3.sectionTitle")?.textContent ?? null,
    title: step.querySelector(":scope > h4.stepLabel")?.textContent ?? null,
    primary,
    /** Where the surface sits among the column's children: the DOM's own "position". */
    place: [...wide.children].indexOf(step),
    /** The control's row is the last thing in the surface, whichever state it is in. */
    last: step.lastElementChild === primary?.parentElement,
  };
}

/**
 * Roll the step's table and type the number in, which is the deterministic way.
 *
 * The number matters: the Kiln Check's quiet band settles the step in one
 * throw, where its other bands send the player on to a second table and the
 * step is still rolling when the first result lands.
 */
async function roll(container: HTMLElement, total: number) {
  await act(async () => {
    surface(container)!.primary!.click();
  });
  await flush();
  const input = container.querySelector<HTMLInputElement>(".rollInput")!;
  fireEvent.change(input, { target: { value: String(total) } });
  const enter = [...container.querySelectorAll<HTMLButtonElement>(".panel.request button")].find((b) => b.textContent === "Enter")!;
  await act(async () => {
    enter.click();
  });
  await flush();
}

describe("the result lands where the instructions were", () => {
  it("draws the step with its phase, its title and one primary control", async () => {
    const { container } = await onTheRoll();
    const now = surface(container)!;
    expect(now.receipt).toBe(false);
    expect(now.phase).toBe("Kiln Check");
    expect(now.title).toBe("Roll the Kiln Check");
    expect(now.primary!.textContent).toBe(kiln.tables["check"]!.title);
  });

  it("replaces the surface with the request while the engine is asking", async () => {
    const { container } = await onTheRoll();
    await act(async () => {
      surface(container)!.primary!.click();
    });
    await flush();
    expect(container.querySelector(".panel.request")).toBeTruthy();
    expect(surface(container)).toBeNull();
  });

  it("shows the result inside the step's own surface, under the step's own head", async () => {
    const { container } = await onTheRoll();
    const before = surface(container)!;
    await roll(container, 12);
    const after = surface(container)!;

    expect(after.receipt).toBe(true);
    expect(after.phase).toBe(before.phase);
    expect(after.title).toBe(before.title);
    expect(after.step.textContent).toContain("12");
    // Nothing above it: the result is the surface, not a card stacked on it.
    expect(container.querySelectorAll(".col.wide .receipt").length).toBe(1);
  });

  it("keeps the primary control last in the surface, with only its word changed", async () => {
    const { container } = await onTheRoll();
    const before = surface(container)!;
    const was = before.primary!.textContent;
    expect(before.last).toBe(true);

    await roll(container, 12);
    const after = surface(container)!;

    // The same surface, in the same place in the column, with the control at
    // the foot of it and drawn at the same size. Only the word is different.
    expect(after.place).toBe(before.place);
    expect(after.last).toBe(true);
    expect(after.primary).toBeTruthy();
    expect(after.primary!.className).toBe(before.primary!.className);
    expect(after.primary!.parentElement!.className).toContain("stepAction");
    expect(after.primary!.textContent).toBe("Carry on");
    expect(after.primary!.textContent).not.toBe(was);
  });

  it("gives the surface back to the step when the result is carried on", async () => {
    const { container } = await onTheRoll();
    await roll(container, 12);
    await act(async () => {
      surface(container)!.primary!.click();
    });
    await flush();
    const after = surface(container)!;
    expect(after.receipt).toBe(false);
    expect(after.title).toBe("Fire the Stage");
    expect(after.primary).toBeTruthy();
  });
});

/**
 * A result somebody else rolled.
 *
 * On a watched run the roll happens on the owner's device and arrives here
 * as a log, by which time the engine has completed the step that made it and
 * the active step is the next one. Nothing here asked for it, so there is no
 * head to have kept, and reading the live step would put the next step's
 * title over the last step's result.
 */
const rolled = [
  ...entered,
  { id: "e3", t: "Rolled", at, purpose: "check", dice: "d100", total: 12, values: [12], source: "player" },
  { id: "e4", t: "OutcomeResolved", at, table: "check", entryId: kiln.tables["check"]!.entries[0]!.id, cause: "phase" },
  { id: "e5", t: "StepCompleted", at, phase: "check", step: 0 },
  { id: "e6", t: "PhaseCompleted", at, phase: "check" },
] as RunEvent[];

/** What a sync pass brings: the grown log on disk, and the word that it grew. */
async function pull(store: RunStore, container: HTMLElement) {
  await store.saveRun({
    runId,
    packId: rolling.id,
    packVersion: rolling.version,
    packTitle: rolling.title,
    events: rolled,
    updatedAt: at,
    role: "viewer",
  });
  await act(async () => {
    syncBus.pulled("run", [runId]);
  });
  await flush(10);
  return surface(container);
}

describe("a result that arrived from somewhere else", () => {
  it("reads under the step that produced it, not the step the run has moved on to", async () => {
    const { container, store } = await onTheRoll("viewer");
    expect(surface(container)!.title).toBe("Roll the Kiln Check");

    const after = (await pull(store, container))!;
    expect(after.receipt).toBe(true);
    expect(after.title).toBe("Roll the Kiln Check");
    expect(after.phase).toBe("Kiln Check");
    // The run itself has moved on: the closing step is the active one now.
    expect(after.title).not.toBe("Fire the Stage");
  });
});

/**
 * A table two phases roll.
 *
 * Nothing says a table belongs to one step, and a shipped sketch rolls the
 * same tables from several phases. A result that arrived from somewhere else
 * is threaded back to a step by its table, so where the table is rolled twice
 * the thread forks, and taking the first fork puts one phase's title over the
 * other phase's result. The second look has a step after its roll, which is
 * what leaves the run inside that phase while its result is read.
 */
const twice = {
  ...kiln,
  id: "com.example.twice",
  unit: { ...kiln.unit, createsSubject: false },
  phases: [
    { id: "first", label: "First look", steps: [{ kind: "rollTable", table: "check", label: "Roll the first check" }] },
    {
      id: "second",
      label: "Second look",
      steps: [
        { kind: "rollTable", table: "check", label: "Roll the second check" },
        { kind: "manual", label: "Write down what it did." },
      ],
    },
    { id: "close", label: "Fire", steps: [{ kind: "finalizeUnit", label: "Fire the Stage" }] },
  ],
} as unknown as Pack;

const looked = [
  { id: "t1", t: "RunStarted", at, packId: twice.id, packVersion: twice.version, runId, mode },
  { id: "t2", t: "UnitEntered", at },
  { id: "t3", t: "Rolled", at, purpose: "check", dice: "d100", total: 12, values: [12], source: "player" },
  { id: "t4", t: "OutcomeResolved", at, table: "check", entryId: kiln.tables["check"]!.entries[0]!.id, cause: "phase" },
  { id: "t5", t: "StepCompleted", at, phase: "first", step: 0 },
  { id: "t6", t: "PhaseCompleted", at, phase: "first" },
] as RunEvent[];

/** The second look's roll, landing on a watcher's page. */
const lookedTwice = [
  ...looked,
  { id: "t7", t: "Rolled", at, purpose: "check", dice: "d100", total: 15, values: [15], source: "player" },
  { id: "t8", t: "OutcomeResolved", at, table: "check", entryId: kiln.tables["check"]!.entries[0]!.id, cause: "phase" },
  { id: "t9", t: "StepCompleted", at, phase: "second", step: 0 },
] as RunEvent[];

/** And the same roll, with the run carried out of the phase that made it. */
const andOn = [
  ...lookedTwice,
  { id: "t10", t: "Checked", at, step: "second#1", item: "0", on: true },
  { id: "t11", t: "StepCompleted", at, phase: "second", step: 1 },
  { id: "t12", t: "PhaseCompleted", at, phase: "second" },
] as RunEvent[];

async function watching(events: RunEvent[]) {
  const store: RunStore = { ...memoryRunStore(), keeps: true };
  const save = (log: RunEvent[]) =>
    store.saveRun({
      runId,
      packId: twice.id,
      packVersion: twice.version,
      packTitle: twice.title,
      events: log,
      updatedAt: at,
      role: "viewer",
    });
  await save(looked);
  store.setActiveRunFor(twice.id, runId);
  const { container } = render(
    <SyncContext.Provider value={sync}>
      <RunView pack={twice} store={store} />
    </SyncContext.Provider>,
  );
  await flush();

  await save(events);
  await act(async () => {
    syncBus.pulled("run", [runId]);
  });
  await flush(10);
  return surface(container);
}

describe("a result whose table more than one phase rolls", () => {
  it("takes the head from the phase the run is in", async () => {
    const after = (await watching(lookedTwice))!;
    expect(after.receipt).toBe(true);
    expect(after.phase).toBe("Second look");
    expect(after.title).toBe("Roll the second check");
  });

  it("borrows no head at all once the run has left the phase that rolled", async () => {
    const after = (await watching(andOn))!;
    expect(after.receipt).toBe(true);
    // No step title, and the receipt's own words in place of a phase line.
    expect(after.title).toBeNull();
    expect(after.phase).toBe("What the dice did");
  });
});
