import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `finish.ts` reaches the store through
// `../plugin.ts`, which registers every action and opens a wire. The hold
// is the whole of this key, so the press is timed here rather than guessed.
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

const { Finish } = await import("./finish.ts");

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
  const finish = new Finish();
  const action = key(alerts);
  finish.onKeyDown({ action } as never);
  vi.advanceTimersByTime(ms);
  await finish.onKeyUp({ action } as never);
}

describe("pressing the finish key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    mock.pressed = [];
    mock.snapshot = { offer: { ending: { label: "Call it a night" } } };
  });
  afterEach(() => vi.useRealTimers());

  it("ends the run when it is held", async () => {
    await pressFor(1600);
    expect(mock.pressed).toEqual([{ press: "answer", answer: { finish: true } }]);
  });

  it("says no to a press, however deliberate", async () => {
    const alerts: string[] = [];
    await pressFor(1400, alerts);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });

  it("alerts on a hold while the run has no ending to take", async () => {
    const alerts: string[] = [];
    mock.snapshot = { offer: { ending: null } };
    await pressFor(1600, alerts);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
