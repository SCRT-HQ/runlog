// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import type { Api } from "../sync/client.ts";
import { heldMove, perRacer, RunView } from "./RunView.tsx";
import { memoryRunStore } from "./store.ts";
import { syncBus } from "../sync/bus.ts";

/**
 * The offer rides along with the snapshot.
 *
 * `RunView` publishes to the server through `useApi()`, a hook rather than a
 * prop, so it is mocked module-wide the way `ChatPanel.test.tsx` mocks it.
 * The run itself is a real, hydrated one-event log in a memory store: the
 * engine's own `reduce` has to accept it, so this is the shortest log that
 * does. `bench` keeps the race, asks and members panels off the tree; none
 * of the three touch the offer, and each would otherwise want its own slice
 * of the API double.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const loaded = loadPackText(readFileSync(join(repoRoot, "packs/demo/pack.yaml"), "utf8"), "yaml");
if (!loaded.ok) throw new Error("the demo pack did not load");
const kiln = loaded.pack;
const mode = Object.keys(kiln.modes)[0]!;

const current: { api: Api | null } = { api: null };
vi.mock("../sync/useApi.ts", () => ({ useApi: () => current.api }));

afterEach(() => {
  current.api = null;
  cleanup();
  vi.useRealTimers();
});

/** A handful of microtask turns: enough for the store's promise chain to settle. */
async function flush(turns = 6) {
  for (let i = 0; i < turns; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * The rest of a log that lands on the pack's one checklist step: into the
 * first Stage, past the manual step that opens it, and past the declared
 * Piece. The Kiln Check and the Constraint are both skipped in Stage 1 by
 * the pack's own rules, so "Throw it." and its checklist come next.
 */
const toTheChecklist = (at: string) => [
  { id: "e2", t: "UnitEntered" as const, at },
  { id: "e3", t: "StepCompleted" as const, at, phase: "enter", step: 0 },
  { id: "e4", t: "PhaseCompleted" as const, at, phase: "enter" },
  { id: "e5", t: "SubjectDeclared" as const, at, subjectType: "bowl" },
  { id: "e6", t: "StepCompleted" as const, at, phase: "declare", step: 0 },
  { id: "e7", t: "PhaseCompleted" as const, at, phase: "declare" },
];

async function renderRunView({
  putSnapshot,
  shared,
  decksAttached = 0,
  rest = () => [],
}: {
  putSnapshot: Api["putSnapshot"];
  shared: boolean;
  decksAttached?: number;
  /** What the run has done since it started, for a test that needs a step. */
  rest?: (at: string) => RunEvent[];
}) {
  current.api = { putSnapshot, myRaces: async () => [] } as unknown as Api;
  const store = memoryRunStore();
  const runId = "run1";
  const at = "2026-09-14T00:00:00.000Z";
  const events = [
    { id: "e1", t: "RunStarted" as const, at, packId: kiln.id, packVersion: kiln.version, runId, mode },
    ...rest(at),
  ] as RunEvent[];
  await store.saveRun({
    runId,
    packId: kiln.id,
    packVersion: kiln.version,
    packTitle: kiln.title,
    events,
    updatedAt: at,
    role: "player",
    shared,
  });
  store.setActiveRunFor(kiln.id, runId);

  // Fake timers are on before the first render, so the debounce's own
  // setTimeout is one this test can wind forward rather than a real one
  // already ticking by the time it asks.
  vi.useFakeTimers();
  render(<RunView pack={kiln} store={store} bench={{ from: "test", onLeave: () => {} }} />);
  await flush();

  if (decksAttached > 0) {
    act(() => {
      syncBus.emit({ t: "gesture", id: runId, kind: "tools", data: { tools: [], count: 0, decks: decksAttached }, at });
    });
  }
}

describe("the offer rides along with the snapshot", () => {
  it("publishes an offer beside the snapshot", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls[0]![1]).toMatchObject({ offer: { seq: expect.any(Number) } });
  });

  it("publishes for a deck even when the run is not shared", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, decksAttached: 1 });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot).toHaveBeenCalled();
  });

  /**
   * The Attached panel says a deck is on the same way it says a tool is:
   * named where a tool would be, nothing where there is neither.
   */
  it("lists a deck in the Attached panel, and says nothing where there is none", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, decksAttached: 1 });
    expect(screen.getByText("Stream Deck")).toBeTruthy();
  });

  it("counts more than one deck", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, decksAttached: 3 });
    expect(screen.getByText("Stream Deck × 3")).toBeTruthy();
  });

  it("says nothing in the Attached panel with no tool and no deck", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false });
    expect(screen.queryByText(/Stream Deck/)).toBeNull();
  });

  /**
   * The toast fires on the way up, once, and then goes: a second `tools`
   * gesture that does not raise the count is not a second arrival, and
   * the note is not still on screen five seconds after the one that was.
   *
   * The bench strip is also `role="status"` (it says "Test run"), so the
   * toast is picked out by its own class rather than by role alone.
   */
  it("tells the table a deck arrived, once, and lets the note go", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false });
    const at = "2026-09-14T00:00:00.000Z";
    const notes = () => screen.getAllByRole("status").filter((el) => el.classList.contains("toast"));

    act(() => {
      syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1 }, at });
    });
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.textContent).toBe("A Stream Deck is on this run.");

    act(() => {
      syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1 }, at });
    });
    // Still exactly one: the count did not rise, so no second note.
    expect(notes()).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(notes()).toHaveLength(0);
  });

  /*
   * Task 12: a named key may carry the whole list and the button under it.
   * The follow key is still sent to the page, which is the point: the
   * preset is a decision somebody chose to put on a key.
   */
  it("offers a deck the whole list and the step's own button", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: true, rest: toTheChecklist });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls.at(-1)![1]).toMatchObject({
      offer: {
        needsPage: "Throw it. on the page",
        presets: [{ kind: "checklist", label: "Tick everything and Done", items: 2 }],
      },
    });
  });
});

/**
 * Review finding: `offer.moves` used to list a finalizing move with
 * something owed, though the page's own button is disabled for exactly
 * that move. `heldMove` is the one rule behind both now, so this is a
 * unit test of the rule rather than an integration one: this file's
 * fixture is a single `RunStarted` event with no obligation of its own
 * to come due, and putting one in the demo pack's way would mean
 * authoring a rule and a log deep enough to trip it, not exercising the
 * filter that reads `heldMove`'s answer.
 */
describe("heldMove", () => {
  it("holds a finalizing move only while something is owed", () => {
    expect(heldMove({ finalizes: true }, 1)).toBe(true);
    expect(heldMove({ finalizes: true }, 0)).toBe(false);
    expect(heldMove({ finalizes: false }, 1)).toBe(false);
    expect(heldMove({}, 1)).toBe(false);
  });
});

/**
 * Review finding: a move the pack asks of each racer was offered to a
 * deck as one press and taken against the table, though the page draws a
 * button per name and records what it does against whoever was named.
 * `perRacer` is the one rule behind both, tested as a rule: the demo pack
 * this file renders has no moderated mode and no per-contestant move, so
 * a roster cannot be got onto its board without authoring both.
 */
describe("perRacer", () => {
  it("splits a per-contestant move only where there is a roster to split it over", () => {
    expect(perRacer({ per: "contestant" }, [1, 2])).toBe(true);
    expect(perRacer({ per: "contestant" }, [])).toBe(false);
    expect(perRacer({ per: "table" }, [1, 2])).toBe(false);
    expect(perRacer({}, [1, 2])).toBe(false);
  });
});
