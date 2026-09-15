import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `clock.ts` reaches the store through `../plugin.ts`,
// which registers every action and opens a wire. Only the clock key is
// under test, and the press it sends is timed here rather than guessed.
const mock = vi.hoisted(() => ({ pressed: [] as unknown[], snapshot: null as unknown }));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return { runs: [], pinned: null, snapshot: mock.snapshot };
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

const { Clock } = await import("./clock.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

/** One press of the key, held for `ms`, with the software's own down and up. */
async function pressFor(ms: number, alerts: string[] = []): Promise<void> {
  const clock = new Clock();
  const action = key(alerts);
  clock.onKeyDown({ action } as never);
  vi.advanceTimersByTime(ms);
  await clock.onKeyUp({ action } as never);
}

describe("pressing the clock key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    mock.pressed = [];
    mock.snapshot = { offer: { clock: { id: "u4", label: "Day 4", status: "running" } } };
  });
  afterEach(() => vi.useRealTimers());

  it("pauses a running clock on a tap", async () => {
    await pressFor(120);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { clock: "u4", do: "pause" } }]);
  });

  it("resumes a paused one", async () => {
    mock.snapshot = { offer: { clock: { id: "u4", label: "Day 4", status: "paused" } } };
    await pressFor(120);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { clock: "u4", do: "resume" } }]);
  });

  it("stops it when the key is held", async () => {
    await pressFor(700);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { clock: "u4", do: "stop" } }]);
  });

  it("sends nothing on the way down: a short press is the way back up", () => {
    const clock = new Clock();
    clock.onKeyDown({ action: key([]) } as never);
    expect(mock.pressed).toEqual([]);
  });

  it("alerts where the run keeps no clock", async () => {
    const alerts: string[] = [];
    mock.snapshot = { offer: { clock: null } };
    await pressFor(120, alerts);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("turns the clock over from a dial and from the touch strip", async () => {
    const clock = new Clock();
    await clock.onDialDown({ action: key([]) } as never);
    await clock.onTouchTap({ action: key([]) } as never);
    expect(mock.pressed).toEqual([
      { press: "answer", answer: { clock: "u4", do: "pause" } },
      { press: "answer", answer: { clock: "u4", do: "pause" } },
    ]);
  });
});
