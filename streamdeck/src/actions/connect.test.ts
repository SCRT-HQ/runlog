import { afterEach, describe, expect, it, vi } from "vitest";

// As in `roll.test.ts`: `connect.ts` reaches the store and the switch
// through `../plugin.ts`, which registers every action and opens a socket.
// Only the connect key is under test.
const mock = vi.hoisted(() => ({
  state: { session: "ok", on: false } as { session: string; on: boolean },
  switched: [] as string[],
}));
vi.mock("../plugin.ts", () => ({
  store: {
    get state() {
      return mock.state;
    },
    dispatch: () => {},
    subscribe: () => () => {},
  },
  sayWho: async () => {},
  wire: { press: () => null },
  turnOn: () => mock.switched.push("on"),
  turnOff: () => mock.switched.push("off"),
}));

const { Connect } = await import("./connect.ts");

const key = (alerts: string[]) => ({
  id: "a1",
  isKey: () => true,
  isDial: () => false,
  showOk: async () => {},
  showAlert: async () => {
    alerts.push("alert");
  },
});

afterEach(() => {
  mock.switched = [];
});

describe("pressing the connect key", () => {
  it("switches the deck on when it is signed in and off", async () => {
    mock.state = { session: "ok", on: false };
    await new Connect().onKeyDown({ action: key([]) } as never);
    expect(mock.switched).toEqual(["on"]);
  });

  it("switches it off again when it is on", async () => {
    mock.state = { session: "ok", on: true };
    await new Connect().onKeyDown({ action: key([]) } as never);
    expect(mock.switched).toEqual(["off"]);
  });

  it("alerts and connects nothing when nobody is signed in", async () => {
    const alerts: string[] = [];
    mock.state = { session: "none", on: false };
    await new Connect().onKeyDown({ action: key(alerts) } as never);
    expect(mock.switched).toEqual([]);
    expect(alerts).toEqual(["alert"]);
  });
});
