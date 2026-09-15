import { describe, expect, it, vi } from "vitest";
import { makeStore } from "./store.ts";
import { openWire } from "./socket.ts";

class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
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

  it("goes back to Sign in again when the bearer is refused", async () => {
    const store = makeStore();
    const wire = openWire({ apiBase: "https://api.test" }, store, { ...deps(), bearer: async () => null });
    wire.connect();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.state.session).toBe("expired");
  });
});
