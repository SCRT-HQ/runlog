// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Pack, type Pack as PackType } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { memoryRunStore, type RunStore } from "./store.ts";
import { useRun } from "./useRun.ts";

/**
 * `rollOn` marked `per: contestant` draws once for each name on the roster,
 * and each draw is recorded against that name.
 *
 * The obligation queue is the mechanism under test, not the roll itself: a
 * deferred trigger whose actions roll `per: contestant` has to run once per
 * name and resolve exactly once, after the last of them, or the rest of the
 * roster never draws.
 */

afterEach(cleanup);

const pack: PackType = Pack.parse({
  schemaVersion: 1,
  id: "dev.runlog.fixture.loadout",
  version: "1.0.0",
  title: "Loadout Fixture",
  license: { id: "CC0-1.0", redistributable: true },
  capabilities: [],
  vocabulary: {
    run: { one: "Run", many: "Runs" },
    unit: { one: "Unit", many: "Units" },
    subject: { one: "Subject", many: "Subjects" },
  },
  tables: {
    gear: {
      resolution: "lookup",
      title: "Gear",
      roll: "d6",
      entries: [{ id: "gear-a", range: [1, 6], text: "a sword" }],
    },
    loot: {
      resolution: "lookup",
      title: "Loot",
      roll: "d6",
      entries: [{ id: "loot-a", range: [1, 6], text: "a coin" }],
    },
    // Never rolled on directly; only its entries' triggers are looked up by
    // the obligations that reference them below.
    source: {
      resolution: "lookup",
      title: "Source",
      roll: "d6",
      entries: [
        {
          id: "roll-gear",
          range: [1, 6],
          text: "Roll for gear.",
          triggers: [{ on: "onEnterUnit", label: "Roll for gear", do: [{ do: "rollOn", table: "gear", per: "contestant" }] }],
        },
        {
          id: "roll-loot",
          range: [1, 6],
          text: "Roll for loot.",
          triggers: [{ on: "onEnterUnit", label: "Roll for loot", do: [{ do: "rollOn", table: "loot" }] }],
        },
      ],
    },
  },
  phases: [{ id: "only", label: "Only", steps: [{ kind: "finalizeUnit" }] }],
  modes: { standard: { label: "Standard" } },
  defaultMode: "standard",
}) as PackType;

const at = "2026-09-22T00:00:00.000Z";
const runId = "run1";

/** A queued obligation whose actions roll on `table`, deferred the same way a table entry's trigger would be. */
function obligationEvent(id: string, table: string, entryId: string): RunEvent {
  return {
    id: `e-${id}`,
    t: "ObligationAdded",
    at,
    obligation: {
      id,
      kind: "trigger",
      text: "Roll for it.",
      on: "onEnterUnit",
      ref: { kind: "tableEntry", table, entryId, index: 0 },
    },
  } as RunEvent;
}

/** A result already on the log, as if a contestant had drawn for an obligation before this session opened. */
function drawnEvent(contestant: string, obligationId: string, table = "gear"): RunEvent {
  return {
    id: `e-drawn-${contestant}`,
    t: "OutcomeResolved",
    at,
    table,
    entryId: `${table}-a`,
    cause: "action",
    contestant,
    obligation: obligationId,
  } as RunEvent;
}

function eventsFor(names: string[], obligation: RunEvent, extra: RunEvent[] = []): RunEvent[] {
  const started: RunEvent = {
    id: "e-start",
    t: "RunStarted",
    at,
    packId: pack.id,
    packVersion: pack.version,
    runId,
    mode: "standard",
    seed: "loadout-test",
  } as RunEvent;
  const contestants: RunEvent[] = names.map(
    (name, i) => ({ id: `e-c${i + 1}`, t: "ContestantAdded", at, contestant: `c${i + 1}`, name }) as RunEvent,
  );
  const entered: RunEvent = { id: "e-unit", t: "UnitEntered", at } as RunEvent;
  return [started, ...contestants, entered, obligation, ...extra];
}

async function openRun(names: string[], obligation: RunEvent, extra: RunEvent[] = []) {
  const store: RunStore = memoryRunStore();
  const events = eventsFor(names, obligation, extra);
  await store.saveRun({ runId, packId: pack.id, packVersion: pack.version, packTitle: pack.title, events, updatedAt: at, seq: 1 });
  store.setActiveRunFor(pack.id, runId);
  const hook = renderHook(() => useRun(pack, store));
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
  await waitFor(() => expect(hook.result.current.state?.obligations).toHaveLength(1));
  return hook;
}

describe("a rollOn marked per: contestant", () => {
  it("draws once for each name on the roster, each stamped with who it was for, and resolves the obligation once", async () => {
    const hook = await openRun(["Ada", "Boro"], obligationEvent("ob1", "source", "roll-gear"));

    act(() => hook.result.current.resolveObligation("ob1", "Roll for gear"));
    await waitFor(() => expect(hook.result.current.state?.obligations.find((o) => o.id === "ob1")?.resolved).toBe(true));

    const draws = hook.result.current.events.filter((e) => e.t === "OutcomeResolved" && e.table === "gear");
    expect(draws).toHaveLength(2);
    expect(draws.map((e) => e.contestant).sort()).toEqual(["c1", "c2"]);

    const resolved = hook.result.current.events.filter((e) => e.t === "ObligationResolved" && e.id === "ob1");
    expect(resolved).toHaveLength(1);
  });

  it("draws once, unstamped, when there is no roster", async () => {
    const hook = await openRun([], obligationEvent("ob1", "source", "roll-gear"));

    act(() => hook.result.current.resolveObligation("ob1", "Roll for gear"));
    await waitFor(() => expect(hook.result.current.state?.obligations.find((o) => o.id === "ob1")?.resolved).toBe(true));

    const draws = hook.result.current.events.filter((e) => e.t === "OutcomeResolved" && e.table === "gear");
    expect(draws).toHaveLength(1);
    expect(draws[0]?.contestant).toBeUndefined();
  });

  it("leaves a per: table obligation to draw once, roster or not", async () => {
    const hook = await openRun(["Ada", "Boro"], obligationEvent("ob2", "source", "roll-loot"));

    act(() => hook.result.current.resolveObligation("ob2", "Roll for loot"));
    await waitFor(() => expect(hook.result.current.state?.obligations.find((o) => o.id === "ob2")?.resolved).toBe(true));

    const draws = hook.result.current.events.filter((e) => e.t === "OutcomeResolved" && e.table === "loot");
    expect(draws).toHaveLength(1);
    expect(draws[0]?.contestant).toBeUndefined();

    const resolved = hook.result.current.events.filter((e) => e.t === "ObligationResolved" && e.id === "ob2");
    expect(resolved).toHaveLength(1);
  });
});

describe("resuming a per: contestant obligation after a reload", () => {
  it("draws only for the contestant the log does not already have a result for, then resolves", async () => {
    const hook = await openRun(["Ada", "Boro"], obligationEvent("ob1", "source", "roll-gear"), [drawnEvent("c1", "ob1")]);

    act(() => hook.result.current.resolveObligation("ob1", "Roll for gear"));
    await waitFor(() => expect(hook.result.current.state?.obligations.find((o) => o.id === "ob1")?.resolved).toBe(true));

    // The one already on the log, plus exactly one more, for the contestant who lacked one.
    const draws = hook.result.current.events.filter((e) => e.t === "OutcomeResolved" && e.table === "gear");
    expect(draws).toHaveLength(2);
    expect(draws.map((e) => e.contestant).sort()).toEqual(["c1", "c2"]);

    const resolved = hook.result.current.events.filter((e) => e.t === "ObligationResolved" && e.id === "ob1");
    expect(resolved).toHaveLength(1);
  });

  it("draws for nobody, and just resolves, when the log already has a result for every contestant, then does nothing more", async () => {
    const hook = await openRun(["Ada", "Boro"], obligationEvent("ob1", "source", "roll-gear"), [
      drawnEvent("c1", "ob1"),
      drawnEvent("c2", "ob1"),
    ]);

    act(() => hook.result.current.resolveObligation("ob1", "Roll for gear"));
    await waitFor(() => expect(hook.result.current.state?.obligations.find((o) => o.id === "ob1")?.resolved).toBe(true));

    const draws = hook.result.current.events.filter((e) => e.t === "OutcomeResolved" && e.table === "gear");
    expect(draws).toHaveLength(2);

    const resolved = hook.result.current.events.filter((e) => e.t === "ObligationResolved" && e.id === "ob1");
    expect(resolved).toHaveLength(1);

    // Pins the loop closed: resolving an obligation the log already shows
    // everybody drew for must not keep committing. Several more render
    // passes land here whether the effect below loops or not; a log length
    // that has stopped growing, rather than the test hanging or the process
    // running out of memory, is the actual assertion.
    const settled = hook.result.current.events.length;
    for (let i = 0; i < 5; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(hook.result.current.events).toHaveLength(settled);
  });
});
