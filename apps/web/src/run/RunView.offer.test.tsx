// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { loadPackText } from "@runlog/rules-schema";
import type { Setup } from "@runlog/rules-schema";
import type { Clock, RunEvent, RunState } from "@runlog/engine";
import type { Api, SessionMember } from "../sync/client.ts";
import { clockOf, fitsTheWire, heldMove, perRacer, RunView, trackersOf } from "./RunView.tsx";
import { memoryRunStore } from "./store.ts";
import { syncBus } from "../sync/bus.ts";
import { SyncContext, type Sync } from "../sync/SyncProvider.tsx";
import { AccountContext, type Account } from "../auth/Account.tsx";

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

/**
 * A setup, and a shipped profile naming the tool it was written for.
 *
 * Neither ships for the demo pack: every setup in the repository is
 * written for a tool this pack has never heard of, and a profile for it
 * would be a file with nothing to say. So both are stood in for, and
 * what is tested is the path from the offer to the run's record rather
 * than what any particular tool does about it.
 *
 * The holder is hoisted because a mock factory is evaluated before this
 * file's own body, and the pack's id is only known once it is loaded.
 * Nothing reads it until an effect runs, by which time it is filled in.
 */
const stood = vi.hoisted(() => ({
  pack: "",
  tool: "DemoTool",
  setup: {
    kind: "setup" as const,
    schemaVersion: 1,
    id: "com.example.setups.starter",
    version: "1.0.0",
    title: "Starter",
    tool: "DemoTool",
    ops: [{ op: "player.give", args: { thing: "clay" } }],
  },
}));
vi.mock("../control/builtin.ts", async (original) => ({
  ...(await original<typeof import("../control/builtin.ts")>()),
  builtins: async () => [{ id: "demo", title: "Demo", pack: stood.pack, profile: { tool: stood.tool } }],
}));
vi.mock("../control/setups.ts", async (original) => ({
  ...(await original<typeof import("../control/setups.ts")>()),
  setupsHere: async () => [stood.setup],
}));
stood.pack = kiln.id;

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

/**
 * Sync, as a press needs it: the socket is not here, so `drove` is a spy
 * and everything else is the off value the app itself falls back to.
 */
const syncWith = (drove: Sync["drove"], gesture: Sync["gesture"] = () => false): Sync => ({
  available: true,
  enabled: true,
  setEnabled: () => {},
  status: "idle",
  last: null,
  syncNow: () => {},
  setPackSync: async () => {},
  gesture,
  drove,
});

/** A signed-in account, for the tests about the deck toast naming who. */
const signedInAs = (id: string): Account => ({
  status: "signed-in",
  user: {
    object: "user",
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    firstName: null,
    lastName: null,
    profilePictureUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastSignInAt: null,
    externalId: undefined,
  },
  signOut: () => {},
  getAccessToken: async () => "token",
});

async function renderRunView({
  putSnapshot,
  shared,
  decksAttached = 0,
  rest = () => [],
  drove = () => {},
  gesture,
  bench = true,
  members,
  account,
}: {
  putSnapshot: Api["putSnapshot"];
  shared: boolean;
  decksAttached?: number;
  /** Off for the one test that wants the panels the bench keeps out. */
  bench?: boolean;
  /** What the run has done since it started, for a test that needs a step. */
  rest?: (at: string) => RunEvent[];
  /** The verdict this device sends back, for the tests about pressing. */
  drove?: Sync["drove"];
  /** The word this device sends out, for the test about handing a setup out. */
  gesture?: Sync["gesture"];
  /** Who is at the table, for the tests about naming a deck's arrival. */
  members?: SessionMember[];
  /** Who is signed in on this device, for the "You" and unsigned-in tests. */
  account?: Account;
}) {
  current.api = {
    putSnapshot,
    myRaces: async () => [],
    asks: async () => [],
    reactions: async () => [],
    listInvites: async () => [],
    people: async () => [],
  } as unknown as Api;
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
    ...(members ? { members } : {}),
  });
  store.setActiveRunFor(kiln.id, runId);

  // Fake timers are on before the first render, so the debounce's own
  // setTimeout is one this test can wind forward rather than a real one
  // already ticking by the time it asks.
  vi.useFakeTimers();
  render(
    <AccountContext.Provider value={account ?? { status: "local" }}>
      <SyncContext.Provider value={syncWith(drove, gesture)}>
        <RunView pack={kiln} store={store} bench={bench ? { from: "test", onLeave: () => {} } : undefined} />
      </SyncContext.Provider>
    </AccountContext.Provider>,
  );
  await flush();

  if (decksAttached > 0) {
    act(() => {
      syncBus.emit({ t: "gesture", id: runId, kind: "tools", data: { tools: [], count: 0, decks: decksAttached }, at });
    });
  }
  return store;
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
   * A deck used to get a heading of its own in the Attached panel, which
   * said how many were on and never whose. The people panel draws one row
   * a person with a mark for the deck, so the heading went and the panel
   * is about tools again.
   */
  it("leaves a deck to the people panel rather than heading the Attached panel with it", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, decksAttached: 1 });
    // By heading: the arrival toast says "Stream Deck" too, and that stays.
    expect(screen.queryByRole("heading", { name: /Stream Deck/ })).toBeNull();
  });

  /*
   * Task 16a: what the run could be played under rides along, so a key
   * face can carry the title and a press can name the id.
   */
  it("publishes the setups this run could be played under", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: true });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls.at(-1)![1]).toMatchObject({
      offer: { setups: [{ id: "com.example.setups.starter", title: "Starter" }] },
    });
  });

  it("says nothing in the Attached panel with no tool and no deck", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false });
    expect(screen.queryByText(/Stream Deck/)).toBeNull();
  });

  /**
   * Who is here is the first thing in the side column, above the board
   * and everything else. It used to be the last panel of nine, which on a
   * phone is a scroll away from the run.
   */
  it("puts the people panel at the top of the side column, above the board", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: false, bench: false });
    const people = screen.getByText("at the table");
    const board = screen.getByText("the board");
    expect(people.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  /**
   * Task 49: the toast names who, the same way the people panel does,
   * once the server sends `deckSubs` alongside the count (#318).
   */
  describe("the deck toast names who", () => {
    const at = "2026-09-14T00:00:00.000Z";
    const notes = () => screen.getAllByRole("status").filter((el) => el.classList.contains("toast"));

    it("names a member at the table", async () => {
      const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
      await renderRunView({
        putSnapshot,
        shared: false,
        members: [{ sub: "user_ASH", name: "Ash", role: "player", joinedAt: at }],
      });

      act(() => {
        syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1, deckSubs: ["user_ASH"] }, at });
      });
      expect(notes()).toHaveLength(1);
      expect(notes()[0]!.textContent).toBe("Ash connected their Stream Deck.");
    });

    it("says You for the viewer's own account", async () => {
      const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
      await renderRunView({ putSnapshot, shared: false, account: signedInAs("user_ME") });

      act(() => {
        syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1, deckSubs: ["user_ME"] }, at });
      });
      expect(notes()).toHaveLength(1);
      expect(notes()[0]!.textContent).toBe("You connected your Stream Deck.");
    });

    it("says Someone for a sub the member list does not show", async () => {
      const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
      await renderRunView({ putSnapshot, shared: false });

      act(() => {
        syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1, deckSubs: ["user_GHOST"] }, at });
      });
      expect(notes()).toHaveLength(1);
      expect(notes()[0]!.textContent).toBe("Someone connected a Stream Deck.");
    });

    it("says nothing for a repeat of the same set", async () => {
      const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
      await renderRunView({
        putSnapshot,
        shared: false,
        members: [{ sub: "user_ASH", name: "Ash", role: "player", joinedAt: at }],
      });

      act(() => {
        syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1, deckSubs: ["user_ASH"] }, at });
      });
      expect(notes()).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(5100));
      expect(notes()).toHaveLength(0);

      act(() => {
        syncBus.emit({ t: "gesture", id: "run1", kind: "tools", data: { tools: [], count: 0, decks: 1, deckSubs: ["user_ASH"] }, at });
      });
      // The same set again names nobody new, so no toast comes back.
      expect(notes()).toHaveLength(0);
    });
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
 * Review finding: the act map between a press and the run's own functions
 * had no test of its own -- `takePress` was tested against a double, and
 * nothing rendered `RunView` and pressed it. This does: the bus carries
 * the press the socket would have delivered, and the verdict is the one
 * the deck would have received.
 *
 * The run is a bare `RunStarted`, so what it offers is the page's own
 * between-units button, and pressing it enters the first Stage: one event
 * appended, which is exactly what the verdict's `seq` has to have caught
 * up with.
 */
describe("a press from a deck", () => {
  it("takes the press and answers with the seq the run moved to", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({ t: "drive", from: "deck1", run: "run1", seq: 1, ref: "r1", press: "primary" });
      await Promise.resolve();
    });
    await flush();

    expect(drove).toHaveBeenCalledWith("deck1", "r1", true, undefined, 2);
  });

  /*
   * Task 16a: a key puts the run under a setup and hands it out, which is
   * the picker in Settings and the button beside it in one press. The
   * gesture goes out after the write, since the server builds what an
   * attached tool is sent from the run's saved profile.
   */
  it("puts the run under a setup on offer, and hands it out", async () => {
    const gesture = vi.fn<Sync["gesture"]>(() => true);
    const store = await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, gesture });

    await act(async () => {
      syncBus.emit({
        t: "drive",
        from: "deck1",
        run: "run1",
        seq: 1,
        ref: "r3",
        press: "answer",
        answer: { setup: "com.example.setups.starter" },
      });
      await Promise.resolve();
    });
    await flush();

    expect((await store.loadRun("run1"))?.setup).toMatchObject({
      from: [{ id: "com.example.setups.starter", title: "Starter", version: "1.0.0" }],
      ops: [{ op: "player.give" }],
    });
    // With what was handed out, so every other screen at the table can
    // name it.
    expect(gesture).toHaveBeenCalledWith("run1", "setup", { title: "Starter", id: "com.example.setups.starter" });
  });

  it("refuses a setup the run is not offering", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({
        t: "drive",
        from: "deck1",
        run: "run1",
        seq: 1,
        ref: "r4",
        press: "answer",
        answer: { setup: "com.example.setups.nowhere" },
      });
      await Promise.resolve();
    });

    expect(drove).toHaveBeenCalledWith("deck1", "r4", false, "That setup is not here.", 1);
  });

  /*
   * Task 28b: the other thing a key can do with a setup file. The
   * operations go out as they were written and the run is left exactly
   * where it was, which is what the stored run is read for: a setup
   * still unset is the difference between this press and the one above.
   */
  it("hands the tool a command, and leaves the run's own setup alone", async () => {
    const gesture = vi.fn<Sync["gesture"]>(() => true);
    const store = await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, gesture });

    await act(async () => {
      syncBus.emit({
        t: "drive",
        from: "deck1",
        run: "run1",
        seq: 1,
        ref: "r8",
        press: "answer",
        answer: { command: "com.example.setups.starter" },
      });
      await Promise.resolve();
    });
    await flush();

    expect(gesture).toHaveBeenCalledWith("run1", "command", {
      id: "com.example.setups.starter",
      title: "Starter",
      ops: [{ op: "player.give", args: { thing: "clay" } }],
    });
    expect(gesture).not.toHaveBeenCalledWith("run1", "setup");
    expect((await store.loadRun("run1"))?.setup).toBeFalsy();
  });

  it("refuses a command the run is not offering", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({
        t: "drive",
        from: "deck1",
        run: "run1",
        seq: 1,
        ref: "r9",
        press: "answer",
        answer: { command: "com.example.setups.nowhere" },
      });
      await Promise.resolve();
    });

    expect(drove).toHaveBeenCalledWith("deck1", "r9", false, "That command is not here.", 1);
  });

  /*
   * Task 24a: a key turns one of the run's own tallies. The demo pack
   * keeps a Calm streak, so the press has something real to move: the
   * correction lands in the log the way the panel's own + writes it, and
   * the verdict names the seq the two events moved the run to.
   */
  it("nudges a tally the run is offering", async () => {
    const drove = vi.fn<Sync["drove"]>();
    const store = await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({ t: "drive", from: "deck1", run: "run1", seq: 1, ref: "r5", press: "answer", answer: { tracker: "calm", by: 1 } });
      await Promise.resolve();
    });
    await flush();

    const saved = ((await store.loadRun("run1"))?.events ?? []) as RunEvent[];
    expect(saved.some((e) => e.t === "CounterChanged" && e.counter === "calm" && e.by === 1)).toBe(true);
    expect(drove).toHaveBeenCalledWith("deck1", "r5", true, undefined, 3);
  });

  it("refuses a tracker the run is not offering", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({ t: "drive", from: "deck1", run: "run1", seq: 1, ref: "r6", press: "answer", answer: { tracker: "kiln", by: 1 } });
      await Promise.resolve();
    });

    expect(drove).toHaveBeenCalledWith("deck1", "r6", false, "That tracker is not here.", 1);
  });

  /*
   * Task 25: a counter that crossed its threshold was carried into the
   * next scene, because the way on was offered over the top of it. The
   * demo pack overheats at five calm Stages, so a log that stands the
   * tally at five has the game owed something real. The Next key now
   * carries that roll, and pressing it puts the trigger's own ask on the
   * page the way the panel's button does.
   */
  const overheated = (at: string) => [{ id: "e2", t: "CounterChanged" as const, at, counter: "calm", set: 5 }];

  it("offers what the game is owed instead of the way on", async () => {
    const putSnapshot = vi.fn<Api["putSnapshot"]>(async () => {});
    await renderRunView({ putSnapshot, shared: true, rest: overheated });
    await vi.advanceTimersByTimeAsync(900);
    expect(putSnapshot.mock.calls.at(-1)![1]).toMatchObject({
      offer: { primary: { id: "owed", kind: "threshold", label: expect.stringMatching(/^The Kiln overheats: /) } },
    });
  });

  it("fires what the game is owed when a deck presses it", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove, rest: overheated });

    await act(async () => {
      syncBus.emit({ t: "drive", from: "deck1", run: "run1", seq: 2, ref: "r7", press: "primary" });
      await Promise.resolve();
    });
    await flush();

    // The trigger rolls on a table, so what the press leaves on screen is
    // the same ask the panel's own button would have left there.
    expect(document.querySelector(".panel.request")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(drove).toHaveBeenCalledWith("deck1", "r7", true, undefined, 2);
  });

  it("refuses a press made against a seq the run has moved past", async () => {
    const drove = vi.fn<Sync["drove"]>();
    await renderRunView({ putSnapshot: vi.fn<Api["putSnapshot"]>(async () => {}), shared: true, drove });

    await act(async () => {
      syncBus.emit({ t: "drive", from: "deck1", run: "run1", seq: 99, ref: "r2", press: "primary" });
      await Promise.resolve();
    });

    expect(drove).toHaveBeenCalledWith("deck1", "r2", false, "That moved on.", 1);
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

/*
 * Fix round 1: the server reads a command gesture to its own bounds and
 * drops the whole frame where a file is past any of them, with a bare 200
 * this page cannot read anything into. So the bounds are held to here as
 * well, tested one at a time against what the server actually takes.
 */
describe("fitsTheWire", () => {
  const file = (over: Partial<Setup>): Setup => ({ ...stood.setup, ...over });
  const give = { op: "player.give" };

  it("takes a setup written the ordinary way", () => {
    expect(fitsTheWire(file({}))).toBe(true);
  });

  it("refuses a title longer than the server reads", () => {
    expect(fitsTheWire(file({ title: "t".repeat(80) }))).toBe(true);
    expect(fitsTheWire(file({ title: "t".repeat(81) }))).toBe(false);
  });

  it("refuses more operations than the server reads", () => {
    expect(fitsTheWire(file({ ops: Array.from({ length: 64 }, () => give) }))).toBe(true);
    expect(fitsTheWire(file({ ops: Array.from({ length: 65 }, () => give) }))).toBe(false);
  });

  it("refuses an operation named longer than the server reads", () => {
    expect(fitsTheWire(file({ ops: [{ op: "o".repeat(64) }] }))).toBe(true);
    expect(fitsTheWire(file({ ops: [{ op: "o".repeat(65) }] }))).toBe(false);
  });

  it("refuses a file with nothing to do and one with no id", () => {
    expect(fitsTheWire(file({ ops: [] }))).toBe(false);
    expect(fitsTheWire(file({ id: "" }))).toBe(false);
  });
});

/*
 * Task 24a: what a deck is offered to turn, and which clock its Pause
 * acts on. Both are rules rather than rendering, and both are read by the
 * offer and by a panel, so they are tested as rules against the demo
 * pack's own dial and tally.
 */
describe("trackersOf", () => {
  const standing = (over: Partial<RunState>) =>
    ({ contestants: [], counters: {}, resources: {}, clocks: [], ...over }) as unknown as RunState;

  it("lists the dials and then the tallies, where each stands", () => {
    expect(trackersOf(kiln, standing({ resources: { glaze: 2 }, counters: { calm: 3 } }))).toEqual([
      { id: "glaze", kind: "resource", label: "Glaze", value: 2, max: 6 },
      { id: "calm", kind: "counter", label: "Calm streak", value: 3, max: null },
      { id: "setbacksSuffered", kind: "counter", label: "Setbacks suffered", value: 0, max: null },
    ]);
  });

  it("falls back to what the pack starts each at", () => {
    expect(trackersOf(kiln, standing({}))).toMatchObject([
      { id: "glaze", value: 3 },
      { id: "calm", value: 0 },
      { id: "setbacksSuffered", value: 0 },
    ]);
  });

  it("offers nothing without a run to read", () => {
    expect(trackersOf(kiln, null)).toEqual([]);
  });
});

describe("clockOf", () => {
  const clock = (id: string, status: Clock["status"]) => ({ id, label: id, status }) as unknown as Clock;
  const with_ = (clocks: Clock[]) => ({ clocks }) as unknown as RunState;

  it("takes the clock that is running over one that is paused", () => {
    expect(clockOf(with_([clock("u3:unit", "paused"), clock("u4:unit", "running")]))).toEqual({
      id: "u4:unit",
      label: "u4:unit",
      status: "running",
    });
  });

  it("takes a paused clock where none is running, so the key that paused it can start it again", () => {
    expect(clockOf(with_([clock("u4:unit", "paused")]))).toMatchObject({ id: "u4:unit", status: "paused" });
  });

  it("offers none where every clock has stopped", () => {
    expect(clockOf(with_([clock("u4:unit", "done")]))).toBeNull();
    expect(clockOf(null)).toBeNull();
  });
});
