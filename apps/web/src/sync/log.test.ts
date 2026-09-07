import { describe, expect, it } from "vitest";
import type { RunEvent } from "@runlog/engine";
import { merge, nameFrom, pendingEvents, stampIds, tailSeq } from "./log.ts";

const at = "2026-01-01T00:00:00Z";
const ev = (id: string, seq?: number, t: RunEvent["t"] = "UnitEntered"): RunEvent =>
  ({ t, at, id, ...(seq !== undefined ? { seq } : {}) }) as RunEvent;

describe("a device's copy of a shared log", () => {
  it("knows how far the server has got, and what is still to send", () => {
    const log = [ev("a", 1), ev("b", 2), ev("c"), ev("d")];
    expect(tailSeq(log)).toBe(2);
    expect(pendingEvents(log).map((e) => e.id)).toEqual(["c", "d"]);
    expect(tailSeq([ev("x")])).toBe(0);
  });

  it("takes the server's numbering for what it sent, and keeps the rest pending", () => {
    const local = [ev("a", 1), ev("b"), ev("c")];
    // The server numbered b, and somebody else's event landed before it.
    const merged = merge(local, [ev("theirs", 2), ev("b", 3)]);
    expect(merged.map((e) => [e.id, e.seq])).toEqual([["a", 1], ["theirs", 2], ["b", 3], ["c", undefined]]);
  });

  it("never loses a pending event, and never keeps a confirmed one twice", () => {
    const local = [ev("a", 1), ev("b", 2), ev("c")];
    const merged = merge(local, [ev("b", 2), ev("c", 3)]);
    expect(merged.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(pendingEvents(merged)).toEqual([]);
  });

  it("prefers the server's copy of an event, which carries the author", () => {
    const merged = merge([ev("a", 1)], [{ ...ev("a", 1), author: "user_2" }]);
    expect(merged[0]?.author).toBe("user_2");
  });

  it("stamps an old log with ids the same way on every device", async () => {
    const old: RunEvent[] = [
      { t: "RunStarted", at, packId: "p", packVersion: "1", mode: "m" },
      { t: "UnitEntered", at },
    ];
    const a = await stampIds("01RUN", old);
    const b = await stampIds("01RUN", old);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a[0]?.id).toMatch(/^L[0-9a-f]{16}$/);
    // A different run: different ids, so two runs' events never collide.
    expect((await stampIds("02RUN", old))[0]?.id).not.toBe(a[0]?.id);
    // Nothing missing: the same array back, so nothing is saved for nothing.
    expect(await stampIds("01RUN", a)).toBe(a);
  });

  it("reads the run's name off the log", () => {
    expect(nameFrom([ev("a", 1)])).toBeUndefined();
    expect(nameFrom([ev("a", 1), { t: "RunRenamed", at, id: "n", name: " Tuesday " }])).toBe("Tuesday");
    expect(nameFrom([{ t: "RunRenamed", at, id: "n", name: "x" }, { t: "RunRenamed", at, id: "m", name: "" }])).toBeUndefined();
  });
});
