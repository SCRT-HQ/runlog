import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { initial, reduce, type DeckState, type Offer } from "../state.ts";

// `next.ts` reaches the store through `../plugin.ts`, which registers every
// action and opens a wire. The press is the only thing under test, so the
// module is stood in for: one state to read, one press to record.
const mock = vi.hoisted(() => ({ state: null as unknown as DeckState, pressed: [] as unknown[] }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return mock.state;
    },
    dispatch: () => {},
    subscribe: () => () => {},
  },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return "r1";
    },
  },
}));

const { Next } = await import("./next.ts");

const T = 1_000_000;
const offer: Offer = {
  seq: 42,
  primary: null,
  moves: [],
  undo: null,
  needsPage: "Tick the list on the page",
  presets: [],
  setups: [],
};

/** A deck signed in, connected, following one run, on the step this offer describes. */
const on = (presets: Offer["presets"]): DeckState => {
  let s = reduce(initial(), { t: "session", state: "ok" }, T);
  s = reduce(s, { t: "on", on: true }, T);
  s = reduce(s, { t: "socket", state: "open" }, T);
  s = reduce(s, { t: "runs", runs: [{ id: "s1", name: "Thursday" }], any: true }, T);
  return reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, presets } } }, T);
};

const key = () => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {},
  showOk: async () => {},
});

describe("pressing the follow key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("takes the checklist the page is offering", async () => {
    mock.state = on([{ kind: "checklist", label: "Tick everything and Next", items: 2 }]);
    await new Next().onKeyDown({ action: key(), payload: { settings: {} } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { ticks: "all" } }]);
  });

  it("takes the first suggestion from a dial as well as a key", async () => {
    mock.state = on([{ kind: "declareSubject", label: "Name what you are going for", suggestions: ["A tall bowl"] }]);
    await new Next().onDialDown({ action: key(), payload: { settings: {} } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { subject: "A tall bowl" } }]);
  });

  it("takes the same decision from a touch tap as from the dial under it", async () => {
    mock.state = on([{ kind: "checklist", label: "Tick everything and Next", items: 2 }]);
    await new Next().onTouchTap({ action: key(), payload: { settings: {} } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { ticks: "all" } }]);
  });

  it("presses the primary and lets the page refuse it where it was told to stop", async () => {
    mock.state = on([{ kind: "checklist", label: "Tick everything and Next", items: 2 }]);
    await new Next().onKeyDown({ action: key(), payload: { settings: { stop: true } } } as never);
    expect(mock.pressed).toEqual([{ press: "primary" }]);
  });
});
