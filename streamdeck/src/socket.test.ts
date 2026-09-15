import { describe, expect, it, vi } from "vitest";
import { makeStore } from "./store.ts";
import { openWire } from "./socket.ts";

class FakeSocket {
  static last: FakeSocket;
  static made = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
    FakeSocket.made++;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
}

const deps = (
  snapshot: unknown = { ready: true, offer: { seq: 1, primary: null, moves: [], undo: null, needsPage: null, presets: [] } },
) => ({
  WebSocket: FakeSocket as never,
  fetch: vi.fn(async () => new Response(JSON.stringify(snapshot))) as never,
  bearer: async () => "tok",
  now: () => 1000,
  random: () => 0,
});

describe("the wire", () => {
  it("says hello, then attaches as a deck and watches the run it is told is held", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.last.url).toBe("wss://api.test/ws?token=tok&as=deck");
    FakeSocket.last.onopen?.();
    expect(FakeSocket.last.sent[0]).toBe(JSON.stringify({ t: "hello" }));
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1", name: "Thursday" }], any: true }) });
    expect(store.state.attached).toBe("s1");
    expect(FakeSocket.last.sent).toContain(JSON.stringify({ t: "watch", id: "s1" }));
  });

  it("fetches the snapshot when the run rings", async () => {
    const store = makeStore();
    const d = deps();
    const wire = openWire({ apiBase: "https://api.test" }, store, d);
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }], any: true }) });
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "changed", id: "s1", seq: 7 }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(d.fetch).toHaveBeenCalledWith(
      "https://api.test/api/sessions/s1/snapshot",
      expect.objectContaining({ headers: { authorization: "Bearer tok" } }),
    );
    expect(store.state.snapshot?.offer?.seq).toBe(1);
  });

  it("presses with the seq of the offer it can see", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }], any: true }) });
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "changed", id: "s1", seq: 7 }) });
    await new Promise((r) => setTimeout(r, 0));
    const ref = wire.press({ press: "primary" });
    expect(ref).toMatch(/^sd-/);
    expect(JSON.parse(FakeSocket.last.sent.at(-1)!)).toEqual({ t: "drive", run: "s1", seq: 1, ref, press: "primary" });
  });

  it("carries the seq a drove verdict reports back into the offer", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }], any: true }) });
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "changed", id: "s1", seq: 7 }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.snapshot?.offer?.seq).toBe(1);
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "drove", ref: "sd-1-1", ok: true, seq: 5 }) });
    expect(store.state.snapshot?.offer?.seq).toBe(5);
  });

  it("drops a null or bare-value frame without throwing or dispatching", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    const dispatch = vi.spyOn(store, "dispatch");
    dispatch.mockClear();
    expect(() => FakeSocket.last.onmessage?.({ data: "null" })).not.toThrow();
    expect(() => FakeSocket.last.onmessage?.({ data: "42" })).not.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("drops malformed entries from a runs frame before dispatching", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({
      data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }, 7, null, { name: "no id" }], any: true }),
    });
    expect(store.state.runs).toEqual([{ id: "s1" }]);
  });

  it("goes back to Sign in again when the bearer is refused", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, { ...deps(), bearer: async () => null });
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.session).toBe("expired");
  });

  // Reconnect closes and dials again; a real close lands after the new socket
  // is already up, and must not report the live one as down.
  it("ignores a close from a socket that has already been replaced", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, deps());
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    const stale = FakeSocket.last;
    wire.disconnect();
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    const live = FakeSocket.last;
    expect(live).not.toBe(stale);
    live.onopen?.();
    expect(store.state.socket).toBe("open");
    stale.onclose?.();
    expect(store.state.socket).toBe("open");
  });

  // The window Reconnect actually opens: the old socket is still closing while
  // the new one is being dialed, so its close lands with nothing newer assigned
  // yet. It must neither report the connection down nor start a second dial
  // beside the one already running.
  it("lets a retired socket close without reporting a drop or dialing again", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const wire = openWire({ apiBase: "https://api.test" }, store, deps());
      wire.connect();
      await vi.advanceTimersByTimeAsync(0);
      const first = FakeSocket.last;
      first.onopen?.();
      expect(store.state.socket).toBe("open");

      wire.disconnect();
      wire.connect();
      await vi.advanceTimersByTimeAsync(0);
      const second = FakeSocket.last;
      second.onopen?.();
      const made = FakeSocket.made;

      // The first socket finally finishes closing, long after it was retired.
      first.onclose?.();
      expect(store.state.socket).toBe("open");

      // No backoff reopen was scheduled by that close.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeSocket.made).toBe(made);
      expect(store.state.socket).toBe("open");
    } finally {
      vi.useRealTimers();
    }
  });

  // The address is joined onto, so a pasted trailing slash must not double up.
  it("drops a trailing slash from the address before joining anything onto it", async () => {
    const store = makeStore();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ready: true }))) as never;
    const wire = openWire(() => ({ apiBase: "https://api.test/" }), store, { ...deps(), fetch });
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeSocket.last.url).toBe("wss://api.test/ws?token=tok&as=deck");
    FakeSocket.last.onopen?.();
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }], any: true }) });
    await new Promise((r) => setTimeout(r, 0));
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0]).toBe("https://api.test/api/sessions/s1/snapshot");
  });
});
