import { describe, expect, it } from "vitest";
import {
  initial,
  reduce,
  nextFace,
  runFace,
  undoFace,
  metricFace,
  connectFace,
  attachedRun,
  idleDeadline,
  IDLE_OFF_MS,
  type DeckState,
  type Offer,
} from "./state";

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

// Signed in and switched on: the two things that had to be true before a
// key could say anything about a run, now that the socket is a state the
// streamer enters rather than a consequence of being configured.
const live = (): DeckState => reduce(reduce(initial(), { t: "session", state: "ok" }, T), { t: "on", on: true }, T);
const open = (runs = [held("s1")]): DeckState => {
  const s = reduce(live(), { t: "socket", state: "open" }, T);
  return reduce(s, { t: "runs", runs, any: true }, T);
};

describe("what the keys say", () => {
  it("asks for a sign-in before anything else", () => {
    expect(nextFace(initial())).toEqual({ title: "Sign in", tone: "dim" });
  });
  it("is offline with a session and no socket", () => {
    const s = live();
    expect(nextFace(s)).toEqual({ title: "Offline", tone: "dim" });
  });
  it("tells nothing synced from nothing open", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: false }, T))).toEqual({ title: "Not synced", tone: "dim" });
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: true }, T))).toEqual({ title: "No run open", tone: "dim" });
  });
  it("attaches to the only held run without being asked", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    expect(attachedRun(s)).toBe("s1");
    expect(runFace(s)).toEqual({ title: "Thursday", tone: "live", when: "The Long Kiln" });
  });
  it("asks to pick between two, and a pin decides", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1"), held("s2", "Friday")], any: true }, T);
    expect(nextFace(s)).toEqual({ title: "Pick a run", tone: "dim" });
    expect(attachedRun(reduce(s, { t: "pin", id: "s2" }, T))).toBe("s2");
  });
  it("a pinned run that ended says so rather than drifting", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "pin", id: "s1" }, T);
    s = reduce(s, { t: "runs", runs: [held("s2", "Friday")], any: true }, T);
    expect(nextFace(s)).toEqual({ title: "That run has ended", tone: "dim" });
  });
  it("draws the offer's primary, and the reason when there is none", () => {
    let s = live();
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
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    s = reduce(s, { t: "drove", ref: "r1", ok: false, say: "That moved on." }, T);
    expect(nextFace(s)).toEqual({ title: "That moved on.", tone: "refuse" });
    expect(nextFace(reduce(s, { t: "tick" }, T + 3001))).toEqual({ title: "Roll the Weather", tone: "live" });
  });
  it("ticks a running clock from the snapshot's own time", () => {
    let s = live();
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
    let s = live();
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
    let s = live();
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

// Controller amendment A: the socket is a state the streamer enters. A key
// that depends on the connection says so, and says what to do about it.
describe("what the keys say while the deck is off", () => {
  it("starts off, and every key names the connection before the run", () => {
    const s = reduce(initial(), { t: "session", state: "ok" }, T);
    expect(s.on).toBe(false);
    const off = { title: "Not connected", tone: "dim", when: "press Connect" };
    expect(nextFace(s)).toEqual(off);
    expect(undoFace(s)).toEqual(off);
    expect(runFace(s)).toEqual(off);
    expect(metricFace(s, "score", T)).toEqual(off);
  });
  it("asks for a sign-in ahead of the connection", () => {
    expect(nextFace(initial())).toEqual({ title: "Sign in", tone: "dim" });
    expect(nextFace(reduce(initial(), { t: "session", state: "expired" }, T))).toEqual({ title: "Sign in again", tone: "dim" });
  });
  it("drops the run it was holding when it goes off, and keeps the pin", () => {
    let s = reduce(open(), { t: "pin", id: "s1" }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    s = reduce(s, { t: "on", on: false }, T);
    expect(s).toMatchObject({ on: false, socket: "closed", runs: [], attached: null, snapshot: null, pinned: "s1" });
  });
  it("remembers whether it went off by itself, and forgets when turned back on", () => {
    const idled = reduce(open(), { t: "on", on: false, idle: true }, T);
    expect(idled.idleOff).toBe(true);
    expect(reduce(idled, { t: "on", on: true }, T).idleOff).toBe(false);
    expect(reduce(open(), { t: "on", on: false }, T).idleOff).toBe(false);
  });
});

// Controller amendment A: the Connect key is the one key that reports the
// connection itself rather than what it is carrying.
describe("what the Connect key says", () => {
  it("asks for a sign-in first", () => {
    expect(connectFace(initial())).toEqual({ title: "Sign in", tone: "dim" });
    expect(connectFace(reduce(initial(), { t: "session", state: "expired" }, T))).toEqual({ title: "Sign in again", tone: "dim" });
  });
  it("is offline when off, and says so differently when it went off by itself", () => {
    expect(connectFace(reduce(initial(), { t: "session", state: "ok" }, T))).toEqual({ title: "Offline", tone: "dim" });
    expect(connectFace(reduce(open(), { t: "on", on: false, idle: true }, T))).toEqual({ title: "Idle · press to connect", tone: "dim" });
  });
  it("is connecting while the socket is opening", () => {
    expect(connectFace(reduce(live(), { t: "socket", state: "connecting" }, T))).toEqual({ title: "Connecting", tone: "dim" });
  });
  it("names the run once it has one", () => {
    expect(connectFace(open())).toEqual({ title: "Thursday", tone: "live", when: "The Long Kiln" });
  });
  it("says what every other key says when it is open and holding nothing", () => {
    const s = reduce(reduce(live(), { t: "socket", state: "open" }, T), { t: "runs", runs: [], any: true }, T);
    expect(connectFace(s)).toEqual({ title: "No run open", tone: "dim" });
    expect(connectFace(open([held("s1"), held("s2", "Friday")]))).toEqual({ title: "Pick a run", tone: "dim" });
  });
});

// Controller amendment A: a deck holding nothing for half an hour closes
// its own socket rather than sitting on one all night.
describe("when an idle connection gives up", () => {
  it("counts down only while it is on, open, and holding nothing", () => {
    const idle = reduce(reduce(live(), { t: "socket", state: "open" }, T), { t: "runs", runs: [], any: false }, T);
    expect(idleDeadline(idle, T)).toBe(T + IDLE_OFF_MS);
    expect(IDLE_OFF_MS).toBe(30 * 60_000);
  });
  it("does not count down while a run is held", () => {
    expect(idleDeadline(open(), T)).toBeNull();
  });
  it("does not count down while off, or while the socket is still opening", () => {
    expect(idleDeadline(reduce(initial(), { t: "session", state: "ok" }, T), T)).toBeNull();
    expect(idleDeadline(reduce(live(), { t: "socket", state: "connecting" }, T), T)).toBeNull();
  });
});
