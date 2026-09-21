import { describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  openLive,
  parseChanged,
  parseDrive,
  parseDrove,
  parseGesture,
  parseHeld,
  socketUrl,
  type Changed,
  type Drive,
  type Drove,
  type Gesture,
  type Held,
} from "./socket.ts";

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
    expect(parseGesture(JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", at: "x" }))).toEqual({
      t: "gesture",
      id: "s1",
      kind: "rolled",
      data: {},
      at: "x",
    });
    expect(parseGesture(JSON.stringify({ t: "gesture", id: "s1" }))).toBeNull();
    expect(parseGesture(JSON.stringify({ t: "changed", id: "s1", seq: 1 }))).toBeNull();
  });

  it("understands one shape and ignores the rest", () => {
    expect(parseChanged(JSON.stringify({ t: "changed", id: "s1", seq: 4 }))).toEqual({ t: "changed", id: "s1", seq: 4 });
    expect(parseChanged(JSON.stringify({ t: "hello" }))).toBeNull();
    expect(parseChanged("not json")).toBeNull();
    expect(parseChanged(new ArrayBuffer(2))).toBeNull();
  });

  it("shapes a drive and refuses what is not one", () => {
    expect(parseDrive(JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "primary" }))).toEqual({
      t: "drive",
      from: "d1",
      run: "s1",
      seq: 3,
      ref: "r1",
      press: "primary",
    });
    expect(parseDrive(JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "move", move: "salvage" }))).toEqual({
      t: "drive",
      from: "d1",
      run: "s1",
      seq: 3,
      ref: "r1",
      press: "move",
      move: "salvage",
    });
    expect(
      parseDrive(JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "answer", answer: { subject: "bowl" } })),
    ).toEqual({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "answer", answer: { subject: "bowl" } });
    // The game's word names no offer and says how it arrived.
    expect(
      parseDrive(
        JSON.stringify({ t: "drive", from: "tool", run: "s1", ref: "r1", press: "move", move: "died", via: "the game", seat: "Mira" }),
      ),
    ).toEqual({ t: "drive", from: "tool", run: "s1", ref: "r1", press: "move", move: "died", via: "the game", seat: "Mira" });
    expect(parseDrive(JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: "3", ref: "r1", press: "primary" }))).toBeNull();
    expect(parseDrive(JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", at: "x" }))).toBeNull();
    expect(parseDrive("not json")).toBeNull();
    expect(parseDrive(new ArrayBuffer(2))).toBeNull();
  });

  it("shapes the verdict on a seat's press and refuses what is not one", () => {
    expect(parseDrove(JSON.stringify({ t: "drove", ref: "r1", ok: true }))).toEqual({ t: "drove", ref: "r1", ok: true });
    expect(parseDrove(JSON.stringify({ t: "drove", ref: "r1", ok: false, say: "That moved on.", seq: 12 }))).toEqual({
      t: "drove",
      ref: "r1",
      ok: false,
      say: "That moved on.",
      seq: 12,
    });
    // Anything but true is a refusal, and words that are not words are dropped.
    expect(parseDrove(JSON.stringify({ t: "drove", ref: "r1", ok: "yes", say: 3 }))).toEqual({ t: "drove", ref: "r1", ok: false });
    expect(parseDrove(JSON.stringify({ t: "drove", ok: true }))).toBeNull();
    expect(parseDrove(JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "primary" }))).toBeNull();
    expect(parseDrove("not json")).toBeNull();
    expect(parseDrove(new ArrayBuffer(2))).toBeNull();
  });

  it("shapes whether a run is held and refuses what is not that", () => {
    expect(parseHeld(JSON.stringify({ t: "held", id: "s1", held: true }))).toEqual({ t: "held", id: "s1", held: true });
    // Nothing said is nobody holding it.
    expect(parseHeld(JSON.stringify({ t: "held", id: "s1" }))).toEqual({ t: "held", id: "s1", held: false });
    expect(parseHeld(JSON.stringify({ t: "held", held: true }))).toBeNull();
    expect(parseHeld(JSON.stringify({ t: "changed", id: "s1", seq: 1 }))).toBeNull();
    expect(parseHeld("not json")).toBeNull();
    expect(parseHeld(new ArrayBuffer(2))).toBeNull();
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
    first.onmessage?.({
      data: JSON.stringify({ t: "gesture", id: "s1", kind: "rolled", data: { total: 3 }, from: "Mira", at: "2026-01-01T00:00:00Z" }),
    });
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

  it("hands over a drive from a deck, and answers it back to the one that asked", async () => {
    FakeSocket.all = [];
    const clock = manualClock();
    const drives: Drive[] = [];
    const live = openLive({
      url: async () => socketUrl("https://runlog.example/api", "t1"),
      onChanged: () => {},
      onDrive: (d) => drives.push(d),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      wait: clock.wait,
    });
    live.watch("s1");
    await tick();
    const socket = FakeSocket.all[0]!;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "primary" }),
    });
    expect(drives).toEqual([{ t: "drive", from: "d1", run: "s1", seq: 3, ref: "r1", press: "primary" }]);

    live.drove("d1", "r1", true);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "drove", to: "d1", ref: "r1", ok: true }));
    live.drove("d1", "r2", false, "That moved on.");
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "drove", to: "d1", ref: "r2", ok: false, say: "That moved on." }));
    // The run's new seq rides back with the verdict, so a deck pressing
    // again need not wait for the doorbell to tell it where the run got to.
    live.drove("d1", "r3", true, undefined, 12);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "drove", to: "d1", ref: "r3", ok: true, seq: 12 }));
  });

  it("presses from a seat, asks whether the run is held, and hands both answers over", async () => {
    FakeSocket.all = [];
    const clock = manualClock();
    const verdicts: Drove[] = [];
    const holds: Held[] = [];
    const live = openLive({
      url: async () => `${socketUrl("https://runlog.example/api", "t1")}&as=seat`,
      onChanged: () => {},
      onDrove: (v) => verdicts.push(v),
      onHeld: (h) => holds.push(h),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      wait: clock.wait,
    });
    // A press is not worth queueing: the offer it names will have moved on
    // by the time the line opens.
    expect(live.press({ run: "s1", seq: 3, ref: "r1", press: "primary" })).toBe(false);
    live.watch("s1");
    await tick();
    const socket = FakeSocket.all[0]!;
    expect(socket.url).toBe("wss://runlog.example/ws?token=t1&as=seat");
    socket.onopen?.();
    socket.sent.length = 0;

    // What goes out is the press and nothing else: who pressed is the
    // server's to stamp, off the token it verified.
    expect(live.press({ run: "s1", seq: 3, ref: "r1", press: "primary" })).toBe(true);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "drive", run: "s1", seq: 3, ref: "r1", press: "primary" }));
    live.press({ run: "s1", seq: 4, ref: "r2", press: "move", move: "temper" });
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "drive", run: "s1", seq: 4, ref: "r2", press: "move", move: "temper" }));
    live.press({ run: "s1", seq: 5, ref: "r3", press: "answer", answer: { tracker: "cracks", by: 1 } });
    expect(socket.sent.at(-1)).toBe(
      JSON.stringify({ t: "drive", run: "s1", seq: 5, ref: "r3", press: "answer", answer: { tracker: "cracks", by: 1 } }),
    );
    expect(socket.sent.join("")).not.toContain("seat");
    expect(socket.sent.join("")).not.toContain("who");

    live.askHeld("s1");
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "held", id: "s1" }));

    socket.onmessage?.({ data: JSON.stringify({ t: "drove", ref: "r1", ok: false, say: "That moved on." }) });
    socket.onmessage?.({ data: JSON.stringify({ t: "held", id: "s1", held: true }) });
    expect(verdicts).toEqual([{ t: "drove", ref: "r1", ok: false, say: "That moved on." }]);
    expect(holds).toEqual([{ t: "held", id: "s1", held: true }]);

    // Down again, and a press has nowhere to go.
    socket.onclose?.();
    expect(live.press({ run: "s1", seq: 6, ref: "r4", press: "primary" })).toBe(false);
    live.askHeld("s1");
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ t: "held", id: "s1" }));
    live.close();
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

  // API Gateway drops a socket idle for ten minutes either way; a ping
  // every four minutes keeps a quiet Play step from costing a reconnect.
  it("pings every four minutes while open, stops on close, and ignores a pong", async () => {
    FakeSocket.all = [];
    vi.useFakeTimers();
    try {
      const live = openLive({
        url: async () => "wss://runlog.example/ws?token=t1",
        onChanged: () => {},
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      });
      live.watch("s1");
      await vi.advanceTimersByTimeAsync(0);
      const socket = FakeSocket.all[0]!;
      socket.onopen?.();
      socket.sent.length = 0;

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(socket.sent).toEqual([JSON.stringify({ t: "ping" })]);

      // The server's answer to our own ping is not acted on.
      socket.onmessage?.({ data: JSON.stringify({ t: "pong" }) });

      live.close();
      socket.sent.length = 0;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(socket.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
