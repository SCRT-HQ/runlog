import { describe, expect, it } from "vitest";
import { backoffMs, openLive, parseChanged, parseGesture, socketUrl, type Changed, type Gesture } from "./socket.ts";

/**
 * A pretend socket: opened, closed and spoken to by the test, so the
 * reconnect and re-watch can be watched without a network.
 */
class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
}

/** Waits that a test releases by hand, in order. */
function manualClock() {
  const pending: Array<{ ms: number; fn: () => void }> = [];
  return {
    pending,
    wait: (ms: number, fn: () => void) => {
      const entry = { ms, fn };
      pending.push(entry);
      return () => {
        const i = pending.indexOf(entry);
        if (i >= 0) pending.splice(i, 1);
      };
    },
    fire() {
      const next = pending.shift();
      next?.fn();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the address", () => {
  it("is the API's base with /api swapped for /ws, over wss, the token in the query", () => {
    expect(socketUrl("https://runlog.example/api", "tok")).toBe("wss://runlog.example/ws?token=tok");
    expect(socketUrl("https://runlog.example/some/path/api/", "tok")).toBe("wss://runlog.example/some/path/ws?token=tok");
    expect(socketUrl("http://localhost:5173/api", "tok")).toBe("ws://localhost:5173/ws?token=tok");
  });
});

describe("the backoff", () => {
  it("doubles from a second and stops at half a minute", () => {
    const flat = () => 0.5;
    expect(backoffMs(0, flat)).toBe(1000);
    expect(backoffMs(1, flat)).toBe(2000);
    expect(backoffMs(3, flat)).toBe(8000);
    expect(backoffMs(10, flat)).toBe(30_000);
  });
});

describe("what comes down", () => {
  it("shapes a gesture and refuses what is not one", () => {
    expect(parseGesture(JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", at: "x" }))).toEqual({ t: "gesture", id: "s1", kind: "rolled", data: {}, at: "x" });
    expect(parseGesture(JSON.stringify({ t: "gesture", id: "s1" }))).toBeNull();
    expect(parseGesture(JSON.stringify({ t: "changed", id: "s1", seq: 1 }))).toBeNull();
  });

  it("understands one shape and ignores the rest", () => {
    expect(parseChanged(JSON.stringify({ t: "changed", id: "s1", seq: 4 }))).toEqual({ t: "changed", id: "s1", seq: 4 });
    expect(parseChanged(JSON.stringify({ t: "hello" }))).toBeNull();
    expect(parseChanged("not json")).toBeNull();
    expect(parseChanged(new ArrayBuffer(2))).toBeNull();
  });
});

describe("the live socket", () => {
  it("connects with a fresh token, sends its watch on open, and hands over changes", async () => {
    FakeSocket.all = [];
    const clock = manualClock();
    const changes: Changed[] = [];
    const gestures: Gesture[] = [];
    const states: boolean[] = [];
    let tokens = 0;
    const live = openLive({
      url: async () => socketUrl("https://runlog.example/api", `t${++tokens}`),
      onChanged: (c) => changes.push(c),
      onGesture: (g) => gestures.push(g),
      onState: (s) => states.push(s),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      wait: clock.wait,
    });
    live.watch("s1");
    await tick();
    const first = FakeSocket.all[0]!;
    expect(first.url).toBe("wss://runlog.example/ws?token=t1");
    expect(live.open).toBe(false);
    first.onopen?.();
    expect(live.open).toBe(true);
    expect(first.sent).toEqual([JSON.stringify({ t: "watch", id: "s1" })]);
    first.onmessage?.({ data: JSON.stringify({ t: "changed", id: "s1", seq: 9 }) });
    first.onmessage?.({ data: "noise" });
    expect(changes).toEqual([{ t: "changed", id: "s1", seq: 9 }]);
    // A gesture goes out only while the line is up, and comes in shaped.
    expect(live.gesture("s1", "rolled", { total: 14 })).toBe(true);
    expect(first.sent.at(-1)).toBe(JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", data: { total: 14 } }));
    first.onmessage?.({ data: JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", data: { total: 3 }, from: "Mira", at: "2026-01-01T00:00:00Z" }) });
    expect(gestures).toEqual([{ t: "gesture", id: "s1", kind: "rolled", data: { total: 3 }, from: "Mira", at: "2026-01-01T00:00:00Z" }]);

    // Switching runs sends the new watch at once.
    live.watch("s2");
    expect(first.sent.at(-1)).toBe(JSON.stringify({ t: "watch", id: "s2" }));

    // The line drops: a reconnect is scheduled, with a new token, and the
    // watch is sent again on open.
    first.onclose?.();
    expect(live.open).toBe(false);
    expect(clock.pending).toHaveLength(1);
    clock.fire();
    await tick();
    const second = FakeSocket.all[1]!;
    expect(second.url).toBe("wss://runlog.example/ws?token=t2");
    second.onopen?.();
    expect(second.sent).toEqual([JSON.stringify({ t: "watch", id: "s2" })]);
    expect(states).toEqual([true, false, true]);

    // Closed for good: no reconnect.
    live.close();
    expect(second.closed).toBe(true);
    expect(clock.pending).toHaveLength(0);
    expect(live.open).toBe(false);
  });

  it("waits and tries again when there is no token to connect with", async () => {
    FakeSocket.all = [];
    const clock = manualClock();
    let fail = true;
    const live = openLive({
      url: async () => {
        if (fail) throw new Error("signed out");
        return "wss://runlog.example/ws?token=ok";
      },
      onChanged: () => {},
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      wait: clock.wait,
    });
    await tick();
    expect(FakeSocket.all).toHaveLength(0);
    expect(clock.pending).toHaveLength(1);
    fail = false;
    clock.fire();
    await tick();
    expect(FakeSocket.all).toHaveLength(1);
    live.close();
  });
});
