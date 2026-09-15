import { describe, expect, it } from "vitest";
import { initial, reduce, nextFace, runFace, undoFace, metricFace, attachedRun, type Offer } from "./state";

const held = (id: string, name = "Thursday") => ({ id, name, packTitle: "The Long Kiln" });
const offer: Offer = {
  seq: 42,
  primary: { id: "roll", label: "Roll the Weather", kind: "rollTable" },
  moves: [],
  undo: { what: "A dry wind." },
  needsPage: null,
  presets: [],
};
const T = 1_000_000;

describe("what the keys say", () => {
  it("asks for a sign-in before anything else", () => {
    expect(nextFace(initial())).toEqual({ title: "Sign in", tone: "dim" });
  });
  it("is offline with a session and no socket", () => {
    const s = reduce(initial(), { t: "session", state: "ok" }, T);
    expect(nextFace(s)).toEqual({ title: "Offline", tone: "dim" });
  });
  it("tells nothing synced from nothing open", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: false }, T))).toEqual({ title: "Not synced", tone: "dim" });
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: true }, T))).toEqual({ title: "No run open", tone: "dim" });
  });
  it("attaches to the only held run without being asked", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    expect(attachedRun(s)).toBe("s1");
    expect(runFace(s)).toEqual({ title: "Thursday", tone: "live", when: "The Long Kiln" });
  });
  it("asks to pick between two, and a pin decides", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1"), held("s2", "Friday")], any: true }, T);
    expect(nextFace(s)).toEqual({ title: "Pick a run", tone: "dim" });
    expect(attachedRun(reduce(s, { t: "pin", id: "s2" }, T))).toBe("s2");
  });
  it("a pinned run that ended says so rather than drifting", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "pin", id: "s1" }, T);
    s = reduce(s, { t: "runs", runs: [held("s2", "Friday")], any: true }, T);
    expect(nextFace(s)).toEqual({ title: "That run has ended", tone: "dim" });
  });
  it("draws the offer's primary, and the reason when there is none", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(nextFace(s)).toEqual({ title: "Roll the Weather", tone: "live" });
    expect(undoFace(s)).toEqual({ title: "Undo", tone: "live", when: "A dry wind." });
    const blocked = reduce(
      s,
      { t: "snapshot", snapshot: { offer: { ...offer, primary: null, needsPage: "Name the bowl on the page" } } },
      T,
    );
    expect(nextFace(blocked)).toEqual({ title: "Name the bowl on the page", tone: "refuse" });
  });
  it("flashes a refusal for three seconds, then goes back", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    s = reduce(s, { t: "drove", ref: "r1", ok: false, say: "That moved on." }, T);
    expect(nextFace(s)).toEqual({ title: "That moved on.", tone: "refuse" });
    expect(nextFace(reduce(s, { t: "tick" }, T + 3001))).toEqual({ title: "Roll the Weather", tone: "live" });
  });
  it("ticks a running clock from the snapshot's own time", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const at = new Date(T).toISOString();
    s = reduce(
      s,
      {
        t: "snapshot",
        snapshot: { at, clocks: [{ id: "u4", label: "Day 4", kind: "timer", seconds: 600, status: "running", elapsedMs: 10_000 }] },
      },
      T,
    );
    // Ruling 4 amends this case: a running timer clock's face also carries
    // a fraction (elapsed / total) for a dial's indicator — 15s of 600s.
    expect(metricFace(s, "clock", T + 5_000)).toEqual({ title: "9:45", tone: "live", when: "Day 4", fraction: 0.025 });
  });

  // Controller ruling 1: a `drove` that carries `seq` is the freshest seq
  // source, so the next press is not stale; one without `seq` leaves the
  // held offer's seq alone.
  it("keeps a driven verdict's seq, but only when it carries one", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    const driven = reduce(s, { t: "drove", ref: "r1", ok: true, seq: 43 }, T);
    expect(driven.snapshot?.offer?.seq).toBe(43);
    const untouched = reduce(s, { t: "drove", ref: "r1", ok: true }, T);
    expect(untouched.snapshot?.offer?.seq).toBe(42);
  });

  // Controller ruling 4: a running timer clock carries a fraction so a
  // dial's indicator can draw it.
  it("gives a running timer's face a fraction for the dial", () => {
    let s = reduce(initial(), { t: "session", state: "ok" }, T);
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const at = new Date(T).toISOString();
    s = reduce(
      s,
      {
        t: "snapshot",
        snapshot: { at, clocks: [{ id: "u4", label: "Day 4", kind: "timer", seconds: 600, status: "running", elapsedMs: 0 }] },
      },
      T,
    );
    expect(metricFace(s, "clock", T + 15_000).fraction).toBe(0.025);
  });
});
