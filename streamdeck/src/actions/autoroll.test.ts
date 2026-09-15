import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `autoroll.ts` reaches the store through
// `../plugin.ts`, which registers every action and opens a wire.
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

const { AutoRoll } = await import("./autoroll.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showAlert: async () => {
    alerts.push("alert");
  },
  showOk: async () => {},
});

describe("pressing the keep-rolling key", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.pressed = [];
    mock.snapshot = null;
  });
  afterEach(() => vi.useRealTimers());

  it("hands the dice to the run, and takes them back", async () => {
    mock.snapshot = { offer: { autoRoll: false } };
    await new AutoRoll().onKeyDown({ action: key([]) } as never);
    mock.snapshot = { offer: { autoRoll: true } };
    await new AutoRoll().onKeyDown({ action: key([]) } as never);
    expect(mock.pressed).toEqual([
      { press: "answer", answer: { autoRoll: true } },
      { press: "answer", answer: { autoRoll: false } },
    ]);
  });

  it("alerts before an offer has landed", async () => {
    const alerts: string[] = [];
    await new AutoRoll().onKeyDown({ action: key(alerts) } as never);
    expect(mock.pressed).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
