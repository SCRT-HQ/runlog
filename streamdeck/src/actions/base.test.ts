import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `base.ts` reaches the store and the wire through
// `../plugin.ts`, which registers every action and opens a socket. Here the
// store is a fake whose subscribers this file drives by hand, so a verdict
// arriving - or never arriving - is something a test can stage.
const mock = vi.hoisted(() => ({
  state: { on: true, flash: null } as { on: boolean; flash: { ref: string; ok: boolean } | null },
  listeners: new Set<(s: unknown) => void>(),
  ref: "r1" as string | null,
  pressed: [] as unknown[],
}));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return mock.state;
    },
    dispatch: () => {},
    subscribe: (fn: (s: unknown) => void) => {
      mock.listeners.add(fn);
      return () => mock.listeners.delete(fn);
    },
  },
  sayWho: async () => {},
  wire: {
    press: (p: unknown) => {
      mock.pressed.push(p);
      return mock.ref;
    },
  },
}));

const { RunlogAction } = await import("./base.ts");

/** An action that does nothing but press, so only `send` is under test. */
class Probe extends RunlogAction {
  face() {
    return { title: "Probe", tone: "live" as const };
  }
  async press(action: unknown): Promise<void> {
    await this.send(action as never, { press: "undo" });
  }
}

/** What the deck was told: "ok" for the checkmark, "alert" for the cross. */
function key(): {
  id: string;
  told: string[];
  isKey: () => boolean;
  isDial: () => boolean;
  showOk: () => Promise<void>;
  showAlert: () => Promise<void>;
} {
  const told: string[] = [];
  return {
    id: "a1",
    told,
    isKey: () => true,
    isDial: () => false,
    showOk: async () => {
      told.push("ok");
    },
    showAlert: async () => {
      told.push("alert");
    },
  };
}

/** The store moving on, as the socket would move it. */
function emit(state: { on: boolean; flash: { ref: string; ok: boolean } | null }): void {
  mock.state = state;
  for (const fn of mock.listeners) fn(state);
}

describe("a press waiting on the server's verdict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mock.state = { on: true, flash: null };
    mock.listeners.clear();
    mock.pressed = [];
    mock.ref = "r1";
  });
  afterEach(() => vi.useRealTimers());

  it("shows the checkmark when the answer is yes", async () => {
    const k = key();
    await new Probe().press(k);
    emit({ on: true, flash: { ref: "r1", ok: true } });
    expect(k.told).toEqual(["ok"]);
    expect(mock.listeners.size).toBe(0);
  });

  it("shows the alert when the server refuses the press", async () => {
    const k = key();
    await new Probe().press(k);
    emit({ on: true, flash: { ref: "r1", ok: false } });
    expect(k.told).toEqual(["alert"]);
    expect(mock.listeners.size).toBe(0);
  });

  it("ignores a verdict for somebody else's press", async () => {
    const k = key();
    await new Probe().press(k);
    emit({ on: true, flash: { ref: "r2", ok: true } });
    expect(k.told).toEqual([]);
    emit({ on: true, flash: { ref: "r1", ok: true } });
    expect(k.told).toEqual(["ok"]);
  });

  it("alerts when no verdict arrives at all, rather than saying nothing", async () => {
    const k = key();
    await new Probe().press(k);
    expect(k.told).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(k.told).toEqual(["alert"]);
    expect(mock.listeners.size).toBe(0);
  });

  it("says nothing when the deck goes off under the press", async () => {
    const k = key();
    await new Probe().press(k);
    emit({ on: false, flash: null });
    await vi.advanceTimersByTimeAsync(5000);
    // The streamer pressed Disconnect; a cross on the key would be
    // reporting a failure that is really an instruction being obeyed.
    expect(k.told).toEqual([]);
    expect(mock.listeners.size).toBe(0);
  });

  it("alerts at once when there is no wire to press", async () => {
    mock.ref = null;
    const k = key();
    await new Probe().press(k);
    expect(k.told).toEqual(["alert"]);
    expect(mock.listeners.size).toBe(0);
  });
});
