import { describe, expect, it } from "vitest";
import {
  initial,
  reduce,
  nextFace,
  nextPress,
  runFace,
  undoFace,
  metricFace,
  connectFace,
  attachedRun,
  idleDeadline,
  setupFace,
  commandFace,
  rollFace,
  pressFace,
  openFace,
  installFace,
  clockFace,
  clockPress,
  autoRollFace,
  autoRollPress,
  finishFace,
  finishPress,
  metricPress,
  FLASH_MS,
  IDLE_OFF_MS,
  importedAsCopy,
  switchedToShipped,
  type DeckState,
  type Offer,
  type OpenTarget,
} from "./state";

const held = (id: string, name = "Thursday") => ({ id, name, packTitle: "The Long Kiln" });
const offer: Offer = {
  seq: 42,
  primary: { id: "roll", label: "Roll the Weather", kind: "rollTable" },
  moves: [],
  undo: { what: "A dry wind." },
  needsPage: null,
  presets: [],
  setups: [],
  trackers: [],
  clock: null,
  autoRoll: false,
  ending: null,
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
    expect(nextFace(initial(), {})).toEqual({ title: "Sign in", tone: "dim" });
  });
  it("is offline with a session and no socket", () => {
    const s = live();
    expect(nextFace(s, {})).toEqual({ title: "Offline", tone: "dim" });
  });
  it("tells nothing synced from nothing open", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: false }, T), {})).toEqual({ title: "Not synced", tone: "dim" });
    expect(nextFace(reduce(s, { t: "runs", runs: [], any: true }, T), {})).toEqual({ title: "No run open", tone: "dim" });
  });
  it("attaches to the only held run without being asked", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    expect(attachedRun(s)).toBe("s1");
    expect(runFace(s)).toEqual({ title: "Thursday", tone: "deck", when: "The Long Kiln" });
  });
  it("asks to pick between two, and a pin decides", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1"), held("s2", "Friday")], any: true }, T);
    expect(nextFace(s, {})).toEqual({ title: "Pick a run", tone: "dim" });
    expect(attachedRun(reduce(s, { t: "pin", id: "s2" }, T))).toBe("s2");
  });
  it("a pinned run that ended says so rather than drifting", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "pin", id: "s1" }, T);
    s = reduce(s, { t: "runs", runs: [held("s2", "Friday")], any: true }, T);
    expect(nextFace(s, {})).toEqual({ title: "That run has ended", tone: "dim" });
  });
  it("draws the offer's primary, and the reason when there is none", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(nextFace(s, {})).toEqual({ title: "Roll the Weather", tone: "live", when: "Next action" });
    expect(undoFace(s)).toEqual({ title: "Undo", tone: "undo" });
    const blocked = reduce(
      s,
      { t: "snapshot", snapshot: { offer: { ...offer, primary: null, needsPage: "Name the bowl on the page" } } },
      T,
    );
    expect(nextFace(blocked, {})).toEqual({ title: "Name the bowl on the page", tone: "refuse", when: "Next action" });
  });
  it("says Undo either way, and dims it when there is nothing to take back", () => {
    let s = open();
    s = reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, undo: null } } }, T);
    expect(undoFace(s)).toEqual({ title: "Undo", tone: "dim" });
  });
  it("flashes a refusal for three seconds, then goes back", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    s = reduce(s, { t: "drove", ref: "r1", ok: false, say: "That moved on." }, T);
    expect(nextFace(s, {})).toEqual({ title: "That moved on.", tone: "refuse" });
    expect(nextFace(reduce(s, { t: "tick" }, T + 3001), {})).toEqual({ title: "Roll the Weather", tone: "live", when: "Next action" });
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
    // a fraction (elapsed / total) for a dial's indicator: 15s of 600s.
    expect(metricFace(s, "clock", T + 5_000)).toEqual({ title: "9:45", tone: "readout", when: "Day 4", fraction: 0.025 });
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

  // Controller ruling 3: the tick reaches a dial holding a running clock,
  // but does nothing to a deck with nothing counting down.
  it("re-ticks a running clock but not an idle deck", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const at = new Date(T).toISOString();
    const running = reduce(
      s,
      {
        t: "snapshot",
        snapshot: { at, clocks: [{ id: "u4", label: "Day 4", kind: "timer", seconds: 600, status: "running", elapsedMs: 0 }] },
      },
      T,
    );
    expect(reduce(running, { t: "tick" }, T + 1000)).not.toBe(running);

    const idle = reduce(
      s,
      {
        t: "snapshot",
        snapshot: { at, clocks: [{ id: "u4", label: "Day 4", kind: "timer", seconds: 600, status: "paused", elapsedMs: 0 }] },
      },
      T,
    );
    expect(reduce(idle, { t: "tick" }, T + 1000)).toBe(idle);
    expect(reduce(s, { t: "tick" }, T + 1000)).toBe(s);
  });
});

// Task 18: a dedicated key applies a setup and hands it out to the tool -
// the offer names which setups the run could hand out.
describe("what the setup key says", () => {
  it("says Set up with nothing chosen, whether or not the offer has landed", () => {
    const s = open();
    expect(setupFace(s, undefined)).toEqual({ title: "Set up", tone: "dim", when: "Apply setup" });
  });

  it("is loading before the offer lands, once a setup is chosen", () => {
    const s = open();
    expect(setupFace(s, { id: "leveling", title: "Leveling" })).toEqual({ title: "Loading…", tone: "dim", when: "Apply setup" });
  });

  it("is live when the setup is on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, setups: [{ id: "leveling", title: "Leveling" }] } } }, T);
    expect(setupFace(s, { id: "leveling", title: "Leveling" })).toEqual({
      title: "Leveling",
      tone: "deck",
      when: "Apply setup",
    });
  });

  it("is dim when the setup is not on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(setupFace(s, { id: "leveling", title: "Leveling" })).toEqual({
      title: "Leveling",
      tone: "dim",
      when: "Not here",
    });
  });

  // The 16b review's Critical: an older page's offer may not name any
  // setups at all, and the unguarded `.some` this replaces would have thrown.
  it("guards an offer that names no setups at all", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const bare = { ...offer } as Partial<Offer>;
    delete bare.setups;
    s = reduce(s, { t: "snapshot", snapshot: { offer: bare as Offer } }, T);
    expect(setupFace(s, { id: "leveling", title: "Leveling" })).toEqual({
      title: "Leveling",
      tone: "dim",
      when: "Not here",
    });
  });
});

// Task 28c: a key that sends a setup's operations to the tool once, without
// touching the run's own setup.
describe("what the command key says", () => {
  it("says Set up with nothing chosen, whether or not the offer has landed", () => {
    const s = open();
    expect(commandFace(s, undefined)).toEqual({ title: "Set up", tone: "dim", when: "Command" });
  });

  it("is loading before the offer lands, once a command is chosen", () => {
    const s = open();
    expect(commandFace(s, { id: "warp", title: "Start of the DLC" })).toEqual({ title: "Loading…", tone: "dim", when: "Command" });
  });

  it("is live when the command is on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, commands: [{ id: "warp", title: "Start of the DLC" }] } } }, T);
    expect(commandFace(s, { id: "warp", title: "Start of the DLC" })).toEqual({
      title: "Start of the DLC",
      tone: "live",
      when: "Send to tool",
    });
  });

  it("is dim when the command is not on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(commandFace(s, { id: "warp", title: "Start of the DLC" })).toEqual({
      title: "Start of the DLC",
      tone: "dim",
      when: "Not here",
    });
  });

  it("guards an offer that names no commands at all", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const bare = { ...offer } as Partial<Offer>;
    delete bare.commands;
    s = reduce(s, { t: "snapshot", snapshot: { offer: bare as Offer } }, T);
    expect(commandFace(s, { id: "warp", title: "Start of the DLC" })).toEqual({
      title: "Start of the DLC",
      tone: "dim",
      when: "Not here",
    });
  });
});

// Task 19b: a dedicated key for the roll alone, which is the only key that rolls.
describe("what the roll key says", () => {
  it("is loading before the offer lands", () => {
    const s = open();
    expect(rollFace(s)).toEqual({ title: "Loading…", tone: "dim", when: "Roll" });
  });

  it("is live when a roll is on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(rollFace(s)).toEqual({ title: "Roll the Weather", tone: "live", when: "Roll" });
  });

  it("says there is nothing to roll when the offer waits on something else", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, primary: { id: "carry-on", label: "Carry on", kind: "move" } } } }, T);
    expect(rollFace(s)).toEqual({ title: "Nothing to roll", tone: "dim", when: "Roll" });
  });
});

describe("what the press key says", () => {
  it("says Set up, not a crash, for a stale roll target from before the key dropped it", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer } }, T);
    expect(pressFace(s, { kind: "roll" })).toEqual({ title: "Set up", tone: "dim" });
  });

  it("names the move it is set to while that move is not on offer", () => {
    // A dim key saying only "Not on offer" says nothing about which of the
    // pack's moves it is. The snapshot's layout names every one of them.
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    const layout = { moves: [{ id: "settle", label: "Settle in" }], counters: [], resources: [] };
    s = reduce(s, { t: "snapshot", snapshot: { offer, layout } }, T);
    expect(pressFace(s, { kind: "move", id: "settle" })).toEqual({ title: "Not on offer", tone: "dim", when: "Settle in" });
    // A move the layout does not name either leaves the key's own name.
    expect(pressFace(s, { kind: "move", id: "push-on" })).toEqual({ title: "Not on offer", tone: "dim", when: "Press" });
  });

  it("carries the same line while the offer has not landed", () => {
    expect(pressFace(open(), { kind: "move", id: "settle" })).toEqual({ title: "Loading…", tone: "dim", when: "Press" });
  });

  it("says the move's own label, on its own, once it is on offer", () => {
    let s = live();
    s = reduce(s, { t: "socket", state: "open" }, T);
    s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
    s = reduce(s, { t: "snapshot", snapshot: { offer: { ...offer, moves: [{ id: "settle", label: "Settle in" }] } } }, T);
    expect(pressFace(s, { kind: "move", id: "settle" })).toEqual({ title: "Settle in", tone: "live" });
  });
});

// Task 23: one key, three pages. The guide is the one target that needs
// nothing of the deck; the run and the rules name what it is holding.
describe("what the open key says", () => {
  it("says Set up with no target chosen", () => {
    expect(openFace(open(), undefined)).toEqual({ title: "Set up", tone: "dim" });
  });

  it("offers the guide signed out, off, and with nothing held", () => {
    const guide = { title: "Guide", tone: "deck", when: "in a browser" };
    expect(openFace(initial(), "guide")).toEqual(guide);
    expect(openFace(reduce(initial(), { t: "session", state: "ok" }, T), "guide")).toEqual(guide);
    expect(openFace(open(), "guide")).toEqual(guide);
  });

  it("names the run and the rules once the deck is following one", () => {
    expect(openFace(open(), "run")).toEqual({ title: "Open the run", tone: "deck", when: "in a browser" });
    expect(openFace(open(), "rules")).toEqual({ title: "Rules", tone: "deck", when: "in a browser" });
  });

  it("says what is missing for the run and the rules, as every key does", () => {
    expect(openFace(initial(), "run")).toEqual({ title: "Sign in", tone: "dim" });
    expect(openFace(reduce(initial(), { t: "session", state: "ok" }, T), "rules")).toEqual({
      title: "Not connected",
      tone: "dim",
      when: "press Connect",
    });
    expect(openFace(open([held("s1"), held("s2", "Friday")]), "run")).toEqual({ title: "Pick a run", tone: "dim" });
  });
});

// The one key that asks nothing of the run: the pack is picked in its
// settings and read off the account, so the face is the pack and nothing
// about the connection.
describe("what the install key says", () => {
  it("names the pack it would build a profile for", () => {
    expect(installFace(initial(), { id: "com.example.ember-trail", title: "Ember Trail" }, "key-1")).toEqual({
      title: "Ember Trail",
      tone: "deck",
      when: "to import",
    });
  });

  it("says Set up with no pack chosen", () => {
    expect(installFace(initial(), undefined, "key-1")).toEqual({ title: "Set up", tone: "dim" });
  });

  it("says the app made a copy, for as long as any other key holds a flash", () => {
    // The Stream Deck app keeps both profiles and names the second one, so
    // the key is where the streamer hears that they now have two.
    const pack = { id: "com.example.ember-trail", title: "Ember Trail" };
    const copied = reduce(initial(), { t: "drove", ref: importedAsCopy("key-1"), ok: true }, T);
    expect(installFace(copied, pack, "key-1")).toEqual({ title: "Imported as a copy", tone: "refuse" });

    // And it is a flash like any other: three seconds, then the key says
    // what it said before.
    expect(installFace(reduce(copied, { t: "tick" }, T + FLASH_MS), pack, "key-1")).toEqual({
      title: "Ember Trail",
      tone: "deck",
      when: "to import",
    });
  });

  it("says where a shipped profile came from, since nothing was imported", () => {
    // A pack the plugin ships a profile for is switched to: the app
    // installs it if it is not there, and the streamer is asked nothing.
    // Without a word the key would look as though the press did nothing.
    const pack = { id: "com.scrthq.runlog.long-kiln", title: "The Long Kiln" };
    const switched = reduce(initial(), { t: "drove", ref: switchedToShipped("key-1"), ok: true }, T);
    expect(installFace(switched, pack, "key-1")).toEqual({ title: "Installed from the plugin", tone: "deck" });
    expect(installFace(switched, pack, "key-2")).toEqual({ title: "The Long Kiln", tone: "deck", when: "to import" });
    expect(installFace(reduce(switched, { t: "tick" }, T + FLASH_MS), pack, "key-1")).toEqual({
      title: "The Long Kiln",
      tone: "deck",
      when: "to import",
    });
  });

  it("says it on the key that was pressed and on no other", () => {
    // Two Install keys on one deck, set to two packs. The one nobody
    // pressed goes on naming its own pack.
    const copied = reduce(initial(), { t: "drove", ref: importedAsCopy("key-1"), ok: true }, T);
    expect(installFace(copied, { id: "com.example.salt-and-signal", title: "Salt and Signal" }, "key-2")).toEqual({
      title: "Salt and Signal",
      tone: "deck",
      when: "to import",
    });
    // And a key with no pack set still says so rather than the copy line.
    expect(installFace(copied, undefined, "key-2")).toEqual({ title: "Set up", tone: "dim" });
  });

  it("is a flash no other key on the deck answers", () => {
    // Marked as having gone fine, so the refusal face every other key wears
    // for a flash is not raised by this one.
    const copied = reduce(live(), { t: "drove", ref: importedAsCopy("key-1"), ok: true }, T);
    expect(rollFace(copied).title).toBe(rollFace(live()).title);
  });
});

// Controller amendment A: the socket is a state the streamer enters. A key
// that depends on the connection says so, and says what to do about it.
describe("what the keys say while the deck is off", () => {
  it("starts off, and every key names the connection before the run", () => {
    const s = reduce(initial(), { t: "session", state: "ok" }, T);
    expect(s.on).toBe(false);
    const off = { title: "Not connected", tone: "dim", when: "press Connect" };
    expect(nextFace(s, {})).toEqual(off);
    expect(undoFace(s)).toEqual(off);
    expect(runFace(s)).toEqual(off);
    expect(metricFace(s, "score", T)).toEqual(off);
  });
  it("asks for a sign-in ahead of the connection", () => {
    expect(nextFace(initial(), {})).toEqual({ title: "Sign in", tone: "dim" });
    expect(nextFace(reduce(initial(), { t: "session", state: "expired" }, T), {})).toEqual({ title: "Sign in again", tone: "dim" });
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
  it("says Connect when off, and names the idle timer when that is why", () => {
    expect(connectFace(reduce(initial(), { t: "session", state: "ok" }, T))).toEqual({ title: "Connect", tone: "dim" });
    expect(connectFace(reduce(open(), { t: "on", on: false, idle: true }, T))).toEqual({
      title: "Connect",
      tone: "dim",
      when: "went idle",
    });
  });
  it("is connecting while the socket is opening, and while it reports offline", () => {
    expect(connectFace(reduce(live(), { t: "socket", state: "connecting" }, T))).toEqual({ title: "Connecting", tone: "link" });
    expect(connectFace(live())).toEqual({ title: "Connecting", tone: "link" });
  });
  it("lights the key blue only once the deck is on", () => {
    // On a full deck it was furniture, and the one key whose whole job is
    // to report the connection read like the ones around it.
    expect(connectFace(reduce(initial(), { t: "session", state: "ok" }, T)).tone).toBe("dim");
    expect(connectFace(live()).tone).toBe("link");
    expect(connectFace(open()).tone).toBe("link");
  });
  it("says Disconnect once the socket is open, whatever the Run key would say", () => {
    expect(connectFace(open())).toEqual({ title: "Disconnect", tone: "link" });
    const s = reduce(reduce(live(), { t: "socket", state: "open" }, T), { t: "runs", runs: [], any: true }, T);
    expect(connectFace(s)).toEqual({ title: "Disconnect", tone: "link" });
    expect(connectFace(open([held("s1"), held("s2", "Friday")]))).toEqual({ title: "Disconnect", tone: "link" });
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

// The follow key takes the two decisions the page offers as presets, unless
// the streamer ticked *Stop at decisions* and kept the reading for themselves.
describe("what the follow key takes", () => {
  const asking = (presets: Offer["presets"], needsPage: string): DeckState =>
    reduce(open(), { t: "snapshot", snapshot: { offer: { ...offer, primary: null, needsPage, presets } } }, T);
  const ticking = asking([{ kind: "checklist", label: "Tick everything and Next", items: 2 }], "Tick the list on the page");
  const naming = asking(
    [{ kind: "declareSubject", label: "Name what you are going for", suggestions: ["A tall bowl", "A wide bowl"] }],
    "Name the bowl on the page",
  );

  it("presses the primary ahead of any preset", () => {
    const s = reduce(
      open(),
      { t: "snapshot", snapshot: { offer: { ...offer, presets: [{ kind: "checklist", label: "Tick", items: 1 }] } } },
      T,
    );
    expect(nextPress(s, {})).toEqual({ press: "primary" });
    expect(nextFace(s, {})).toEqual({ title: "Roll the Weather", tone: "live", when: "Next action" });
  });

  it("ticks a checklist and presses the step's own button", () => {
    expect(nextPress(ticking, {})).toEqual({ press: "answer", answer: { ticks: "all" } });
    expect(nextFace(ticking, {})).toEqual({ title: "Tick everything and Next", tone: "live", when: "Next action" });
  });

  it("takes the first suggestion for a declaration", () => {
    expect(nextPress(naming, {})).toEqual({ press: "answer", answer: { subject: "A tall bowl" } });
    expect(nextFace(naming, {})).toEqual({ title: "A tall bowl", tone: "live", when: "Next action" });
  });

  it("leaves a declaration with nothing to suggest to the page", () => {
    const bare = asking([{ kind: "declareSubject", label: "Name what you are going for" }], "Name the bowl on the page");
    expect(nextPress(bare, {})).toBeNull();
    expect(nextFace(bare, {})).toEqual({ title: "Name the bowl on the page", tone: "refuse", when: "Next action" });
  });

  it("stops at both where the key was told to", () => {
    expect(nextPress(ticking, { stop: true })).toBeNull();
    expect(nextPress(naming, { stop: true })).toBeNull();
    expect(nextFace(ticking, { stop: true })).toEqual({ title: "Tick the list on the page", tone: "refuse", when: "Next action" });
    expect(nextFace(naming, { stop: true })).toEqual({ title: "Name the bowl on the page", tone: "refuse", when: "Next action" });
  });

  it("has nothing to take before a snapshot lands", () => {
    expect(nextPress(open(), {})).toBeNull();
  });

  it("says which key it is whatever it is offering", () => {
    // The line under the title used to be the decision's label, which was
    // blank as often as it was useful. The key's own name never is.
    const faces = [nextFace(open(), {}), nextFace(ticking, {}), nextFace(naming, {}), nextFace(ticking, { stop: true })];
    for (const f of faces) expect(f.when).toBe("Next action");
  });
});

// Task 24b: the offer carries the trackers a deck may move, the clock it
// may turn over, who is throwing the dice, and how the run would end.
const withOffer = (extra: Partial<Offer>, snapshot: Record<string, unknown> = {}): DeckState => {
  let s = live();
  s = reduce(s, { t: "socket", state: "open" }, T);
  s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
  return reduce(s, { t: "snapshot", snapshot: { ...snapshot, offer: { ...offer, ...extra } } }, T);
};

/** A run keeping one timer, as the snapshot and the offer each describe it. */
const ticking = (status: "running" | "paused" | "done", elapsedMs = 0) =>
  withOffer(
    { clock: { id: "u4", label: "Day 4", status } },
    {
      at: new Date(T).toISOString(),
      clocks: [{ id: "u4", label: "Day 4", kind: "timer", seconds: 600, status, elapsedMs }],
    },
  );

/** An offer with one of the four new fields left off it, as an older page would publish. */
const older = (drop: keyof Offer): DeckState => {
  const bare = { ...offer } as Partial<Offer>;
  delete bare[drop];
  let s = live();
  s = reduce(s, { t: "socket", state: "open" }, T);
  s = reduce(s, { t: "runs", runs: [held("s1")], any: true }, T);
  return reduce(s, { t: "snapshot", snapshot: { offer: bare as Offer } }, T);
};

describe("what the clock key says", () => {
  it("is loading before the offer lands", () => {
    expect(clockFace(open(), T)).toEqual({ title: "Loading…", tone: "dim", when: "Clock" });
  });

  it("says there is no clock where the run keeps none", () => {
    expect(clockFace(withOffer({ clock: null }), T)).toEqual({ title: "No clock", tone: "dim", when: "Clock" });
  });

  it("counts a running clock down, lit, with the bar a dial draws", () => {
    expect(clockFace(ticking("running"), T + 15_000)).toEqual({
      title: "9:45",
      tone: "live",
      when: "Day 4",
      fraction: 0.025,
    });
  });

  it("keeps a paused clock's time on the face and says it is paused", () => {
    expect(clockFace(ticking("paused", 15_000), T + 60_000)).toEqual({ title: "9:45", tone: "dim", when: "paused" });
  });

  it("says nothing is left of a clock that is done", () => {
    expect(clockFace(ticking("done", 600_000), T)).toEqual({ title: "0:00", tone: "dim", when: "done" });
  });

  it("guards an older page, whose offer names no clock at all", () => {
    expect(clockFace(older("clock"), T)).toEqual({ title: "No clock", tone: "dim", when: "Clock" });
  });
});

describe("what the clock key presses", () => {
  it("pauses a running clock and resumes a paused one", () => {
    expect(clockPress(ticking("running"), false)).toEqual({ press: "answer", answer: { clock: "u4", do: "pause" } });
    expect(clockPress(ticking("paused"), false)).toEqual({ press: "answer", answer: { clock: "u4", do: "resume" } });
  });

  it("stops it when it is held", () => {
    expect(clockPress(ticking("running"), true)).toEqual({ press: "answer", answer: { clock: "u4", do: "stop" } });
  });

  it("presses nothing with no clock, or one that has already run out", () => {
    expect(clockPress(withOffer({ clock: null }), false)).toBeNull();
    expect(clockPress(ticking("done", 600_000), true)).toBeNull();
    expect(clockPress(open(), false)).toBeNull();
  });
});

describe("what the keep-rolling key says", () => {
  it("is loading before the offer lands", () => {
    expect(autoRollFace(open())).toEqual({ title: "Loading…", tone: "dim", when: "Keep rolling" });
  });

  it("names who is throwing the dice, over the key's own name", () => {
    expect(autoRollFace(withOffer({ autoRoll: true }))).toEqual({
      title: "Rolling for you",
      tone: "live",
      when: "Keep rolling",
    });
    expect(autoRollFace(withOffer({ autoRoll: false }))).toEqual({
      title: "Roll by hand",
      tone: "deck",
      when: "Keep rolling",
    });
  });

  it("sends the other setting, and nothing before an offer lands", () => {
    expect(autoRollPress(withOffer({ autoRoll: false }))).toEqual({ press: "answer", answer: { autoRoll: true } });
    expect(autoRollPress(withOffer({ autoRoll: true }))).toEqual({ press: "answer", answer: { autoRoll: false } });
    expect(autoRollPress(open())).toBeNull();
  });

  it("takes an older page, which says nothing about it, for rolling by hand", () => {
    expect(autoRollFace(older("autoRoll")).title).toBe("Roll by hand");
    expect(autoRollPress(older("autoRoll"))).toEqual({ press: "answer", answer: { autoRoll: true } });
  });
});

describe("what the finish key says", () => {
  it("is loading before the offer lands", () => {
    expect(finishFace(open())).toEqual({ title: "Loading…", tone: "dim", when: "Finish" });
  });

  it("says not yet while the run has no ending to take", () => {
    expect(finishFace(withOffer({ ending: null }))).toEqual({ title: "Not yet", tone: "dim", when: "Finish" });
    expect(finishPress(withOffer({ ending: null }))).toBeNull();
    expect(finishFace(older("ending"))).toEqual({ title: "Not yet", tone: "dim", when: "Finish" });
  });

  it("carries the ending on a ground of its own, and asks to be held", () => {
    const s = withOffer({ ending: { label: "Call it a night" } });
    expect(finishFace(s)).toEqual({ title: "Call it a night", tone: "end", when: "hold to finish" });
    expect(finishPress(s)).toEqual({ press: "answer", answer: { finish: true } });
    // The color is on the key only while the press would land.
    expect(finishFace(withOffer({ ending: null })).tone).toBe("dim");
  });
});

describe("what a metric key presses", () => {
  const trackers: Offer["trackers"] = [
    { id: "hits", kind: "counter", label: "Hits", value: 3, max: null },
    { id: "flasks", kind: "resource", label: "Flasks", value: 2, max: 4 },
  ];
  const keeping = withOffer({ trackers });

  it("steps a counter up by one on a tap", () => {
    expect(metricPress(keeping, { counter: "hits" }, undefined, false)).toEqual({
      press: "answer",
      answer: { tracker: "hits", by: 1 },
    });
    expect(metricPress(keeping, { counter: "hits" }, { kind: "step" }, false)).toEqual({
      press: "answer",
      answer: { tracker: "hits", by: 1 },
    });
  });

  it("puts it at the number the key was set to", () => {
    expect(metricPress(keeping, { resource: "flasks" }, { kind: "set", value: 4 }, false)).toEqual({
      press: "answer",
      answer: { tracker: "flasks", to: 4 },
    });
  });

  it("takes one back off on a hold, whichever way the key was set", () => {
    expect(metricPress(keeping, { counter: "hits" }, { kind: "step" }, true)).toEqual({
      press: "answer",
      answer: { tracker: "hits", by: -1 },
    });
    expect(metricPress(keeping, { resource: "flasks" }, { kind: "set", value: 4 }, true)).toEqual({
      press: "answer",
      answer: { tracker: "flasks", by: -1 },
    });
  });

  it("presses nothing for the fields that are the run's own arithmetic", () => {
    for (const field of ["score", "unit", "clock", "latest", "leader"] as const) {
      expect(metricPress(keeping, field, undefined, false), field).toBeNull();
    }
    expect(metricPress(keeping, undefined, undefined, false)).toBeNull();
  });

  it("presses nothing for a tracker this run does not keep, or under the other kind's name", () => {
    expect(metricPress(keeping, { counter: "runes" }, undefined, false)).toBeNull();
    expect(metricPress(keeping, { resource: "hits" }, undefined, false)).toBeNull();
    expect(metricPress(older("trackers"), { counter: "hits" }, undefined, false)).toBeNull();
    expect(metricPress(open(), { counter: "hits" }, undefined, false)).toBeNull();
  });
});

// Task 24b: a threshold or a global roll the run is owed arrives as the
// primary, and the follow key takes it like any other.
describe("what the follow key does with an owed press", () => {
  it("draws its label and presses the primary", () => {
    const s = withOffer({ primary: { id: "owed", label: "Take the level-up", kind: "owed" } });
    expect(nextFace(s, {})).toEqual({ title: "Take the level-up", tone: "live", when: "Next action" });
    expect(nextPress(s, {})).toEqual({ press: "primary" });
  });
});

// Task 24b: the Open key gains the dock and a new run.
describe("where else the open key points", () => {
  it("names the dock and a new run once the deck is following one", () => {
    expect(openFace(open(), "dock")).toEqual({ title: "The dock", tone: "deck", when: "in a browser" });
    expect(openFace(open(), "newrun")).toEqual({ title: "A new run", tone: "deck", when: "in a browser" });
  });

  it("says what is missing first, as the run and the rules do", () => {
    expect(openFace(initial(), "dock")).toEqual({ title: "Sign in", tone: "dim" });
  });

  it("answers newrun beside guide, without waiting on a run to attach to", () => {
    expect(openFace(initial(), "newrun")).toEqual({ title: "A new run", tone: "deck", when: "in a browser" });
    expect(openFace(open([held("s1"), held("s2", "Friday")]), "newrun")).toEqual({
      title: "A new run",
      tone: "deck",
      when: "in a browser",
    });
  });

  it("says 'Set up' for a target it no longer reads, rather than drawing nothing", () => {
    // Handing a profile over left this key for Install a profile. A deck
    // that imported a profile before that still has keys set to it, and
    // those say what an unset key says rather than going blank.
    const stale = "profile" as unknown as OpenTarget;
    expect(openFace(open(), stale)).toEqual({ title: "Set up", tone: "dim" });
    expect(openFace(initial(), stale)).toEqual({ title: "Set up", tone: "dim" });
  });
});
