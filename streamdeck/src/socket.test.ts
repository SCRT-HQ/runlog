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

  // API Gateway drops a socket idle for ten minutes either way; a ping every
  // four minutes keeps a quiet Play step from costing a reconnect.
  it("pings every four minutes while open, stops on close, and ignores a pong", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const wire = openWire({ apiBase: "https://api.test" }, store, deps());
      wire.connect();
      await vi.advanceTimersByTimeAsync(0);
      const socket = FakeSocket.last;
      socket.onopen?.();
      socket.sent.length = 0;

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(socket.sent).toEqual([JSON.stringify({ t: "ping" })]);

      // A pong back is not acted on.
      const dispatch = vi.spyOn(store, "dispatch");
      dispatch.mockClear();
      socket.onmessage?.({ data: JSON.stringify({ t: "pong" }) });
      expect(dispatch).not.toHaveBeenCalled();

      wire.disconnect();
      socket.sent.length = 0;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(socket.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  // A timer from a socket that reconnect has already superseded must not
  // send, the same as any other handler tied to a retired generation.
  it("silences a superseded socket's keepalive timer", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const wire = openWire({ apiBase: "https://api.test" }, store, deps());
      wire.connect();
      await vi.advanceTimersByTimeAsync(0);
      const first = FakeSocket.last;
      first.onopen?.();
      first.sent.length = 0;

      wire.disconnect();
      wire.connect();
      await vi.advanceTimersByTimeAsync(0);
      const second = FakeSocket.last;
      second.onopen?.();
      second.sent.length = 0;

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(first.sent).toEqual([]);
      expect(second.sent).toEqual([JSON.stringify({ t: "ping" })]);
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

  // A dial that has been superseded must not report a lapsed session: `reduce`
  // takes that verdict as a full reset, which would tear down the connection
  // that replaced it.
  it("swallows a late refusal from a dial that has been superseded", async () => {
    const store = makeStore();
    let refuse: (token: string | null) => void = () => {};
    let firstDial = true;
    const wire = openWire({ apiBase: "https://api.test" }, store, {
      ...deps(),
      bearer: async () => {
        if (!firstDial) return "tok";
        firstDial = false;
        return new Promise<string | null>((r) => (refuse = r));
      },
    });

    wire.connect(); // the first dial's token never comes back
    await new Promise((r) => setTimeout(r, 0));
    wire.disconnect();
    wire.connect(); // the second dial gets one straight away
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    expect(store.state.socket).toBe("open");

    refuse(null); // and now the first dial finally hears "no"
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.session).toBe("none");
    expect(store.state.socket).toBe("open");
  });

  // Same rule for the snapshot the doorbell asks for: an answer that lands
  // after the connection it was asked for is gone belongs to nobody.
  it("drops a snapshot that arrives after the connection it was fetched for", async () => {
    const store = makeStore();
    let land: (res: Response) => void = () => {};
    let firstFetch = true;
    const wire = openWire({ apiBase: "https://api.test" }, store, {
      ...deps(),
      fetch: (async () => {
        if (!firstFetch) return new Response(JSON.stringify({ fresh: true }));
        firstFetch = false;
        return new Promise<Response>((r) => (land = r));
      }) as never,
    });

    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();
    // Holding a run starts the snapshot fetch that is about to be orphaned.
    FakeSocket.last.onmessage?.({ data: JSON.stringify({ t: "runs", runs: [{ id: "s1" }], any: true }) });
    await new Promise((r) => setTimeout(r, 0));

    wire.disconnect();
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    FakeSocket.last.onopen?.();

    land(new Response(JSON.stringify({ stale: true })));
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.snapshot).toBeNull();
  });
});
