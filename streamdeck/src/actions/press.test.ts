import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `next.test.ts`: `press.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the press is under test.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[] }));
vi.mock("../plugin.ts", () => ({
  store: { state: { runs: [], pinned: null, snapshot: null }, dispatch: () => {}, subscribe: () => () => {} },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return "r1";
    },
  },
}));

const { Press } = await import("./press.ts");

const key = () => ({ id: "a1", isKey: () => true, isDial: () => false, showAlert: async () => {}, showOk: async () => {} });

// The two presets a key can be set to, each answered in the words
// `apps/web/src/run/takePress.ts` takes.
describe("pressing a preset key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("ticks a checklist whole", async () => {
    const settings = { target: { kind: "answer", preset: "checklist", value: "" } };
    await new Press().onKeyDown({ action: key(), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { ticks: "all" } }]);
  });

  it("declares the subject it was set to", async () => {
    const settings = { target: { kind: "answer", preset: "declareSubject", value: "A tall bowl" } };
    await new Press().onKeyDown({ action: key(), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { subject: "A tall bowl" } }]);
  });
});

// Task 16b: a Press key set to a setup applies it and hands it out to the
// tool in one act.
describe("pressing a setup key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("answers with the setup it was set to", async () => {
    const settings = { target: { kind: "setup", id: "leveling", title: "Leveling" } };
    await new Press().onKeyDown({ action: key(), payload: { settings } } as never);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { setup: "leveling" } }]);
  });
});
