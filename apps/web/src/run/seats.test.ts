import { describe, expect, it } from "vitest";
import type { Pack } from "@runlog/rules-schema";
import type { RunState } from "@runlog/engine";
import { contestantName, seatMay, seatingOf } from "./seats.ts";

const members = [
  { sub: "owner", role: "owner" as const, joinedAt: "2026-09-01T00:00:00Z", name: "Mo" },
  { sub: "ada", role: "player" as const, joinedAt: "2026-09-02T00:00:00Z", name: "Ada" },
  { sub: "watcher", role: "viewer" as const, joinedAt: "2026-09-03T00:00:00Z", name: "Bo" },
];

const packWith = (mode: Record<string, unknown>): Pack => ({ defaultMode: "m", modes: { m: mode } }) as unknown as Pack;
const state = (mode = "m", players = 2): RunState => ({ mode, players, unit: 1 }) as unknown as RunState;

describe("who is at the table", () => {
  it("numbers the seats from the members, owner first, and leaves watchers out", () => {
    const seating = seatingOf(packWith({}), state(), members, "owner");
    expect(seating.kind).toBe("solo");
    expect([...seating.seats]).toEqual([
      ["owner", 1],
      ["ada", 2],
    ]);
    expect([...seating.names]).toEqual([
      ["Mo", 1],
      ["Ada", 2],
    ]);
  });

  it("seats a member with no name on file, by id", () => {
    const quiet = [...members, { sub: "quiet", role: "player" as const, joinedAt: "2026-09-04T00:00:00Z" }];
    const seating = seatingOf(packWith({ players: { min: 2, max: 4 } }), state(), quiet, "owner");
    expect(seating.seats.get("quiet")).toBe(3);
    expect([...seating.names]).toEqual([
      ["Mo", 1],
      ["Ada", 2],
    ]);
    expect(seatMay({ press: "primary", who: "quiet" }, seating)).toBe(null);
  });

  it("reads a table mode from the mode's players, and a moderated one from its moderation", () => {
    expect(seatingOf(packWith({ players: { min: 2, max: 4 } }), state(), members, "owner").kind).toBe("table");
    expect(seatingOf(packWith({ moderated: { contestants: { min: 2, max: 10 } } }), state(), members, "owner").kind).toBe("moderated");
  });

  it("gives a solo pack one acting seat, the owner's", () => {
    expect(seatingOf(packWith({}), state(), members, "owner").acting).toEqual([1]);
  });

  it("gives a table with no role marked every seat", () => {
    expect(seatingOf(packWith({ players: { min: 2, max: 4 } }), state(), members, "owner").acting).toBe(null);
  });
});

describe("what a seat may press", () => {
  const solo = seatingOf(packWith({}), state(), members, "owner");
  const table = seatingOf(packWith({ players: { min: 2, max: 4 } }), state(), members, "owner");

  it("refuses somebody who is not at the table", () => {
    expect(seatMay({ press: "primary", seat: "Nobody" }, table)).toEqual({ ok: false, say: "You are not at this table." });
  });

  it("refuses an account that is not a member, whatever name the press carries", () => {
    expect(seatMay({ press: "primary", seat: "Ada", who: "stranger" }, table)).toEqual({
      ok: false,
      say: "You are not at this table.",
    });
  });

  it("takes the press from the account behind the name, and the name alone from a press with no account on it", () => {
    expect(seatMay({ press: "primary", seat: "Ada", who: "ada" }, table)).toBe(null);
    expect(seatMay({ press: "primary", seat: "Ada" }, table)).toBe(null);
  });

  it("lets a seat at a table press the primary and a move", () => {
    expect(seatMay({ press: "primary", seat: "Ada" }, table)).toBe(null);
    expect(seatMay({ press: "move", seat: "Ada" }, table)).toBe(null);
  });

  it("holds the primary back on a solo pack, where the one seat is the owner's", () => {
    expect(seatMay({ press: "primary", seat: "Ada" }, solo)).toEqual({ ok: false, say: "The host presses that on this pack." });
  });

  it("takes an answer and a tracker from any seat, in any mode", () => {
    expect(seatMay({ press: "answer", seat: "Ada", answer: { subject: "Bowl 3" } }, solo)).toBe(null);
    expect(seatMay({ press: "answer", seat: "Ada", answer: { tracker: "kilns", by: 1 } }, solo)).toBe(null);
    expect(seatMay({ press: "answer", seat: "Ada", answer: { ticks: "all" } }, table)).toBe(null);
  });

  it("keeps the host's own controls for the host", () => {
    expect(seatMay({ press: "undo", seat: "Ada" }, table)).toEqual({ ok: false, say: "Taking a move back is the host's." });
    expect(seatMay({ press: "answer", seat: "Ada", answer: { setup: "s" } }, table)).toEqual({
      ok: false,
      say: "Handing out a setup is the host's.",
    });
    expect(seatMay({ press: "answer", seat: "Ada", answer: { command: "s" } }, table)).toEqual({
      ok: false,
      say: "Handing out a command is the host's.",
    });
    expect(seatMay({ press: "answer", seat: "Ada", answer: { clock: "c", do: "pause" } }, table)).toEqual({
      ok: false,
      say: "The clock is the host's.",
    });
    expect(seatMay({ press: "answer", seat: "Ada", answer: { autoRoll: true } }, table)).toEqual({
      ok: false,
      say: "Rolling for the table is the host's.",
    });
    expect(seatMay({ press: "answer", seat: "Ada", answer: { finish: true } }, table)).toEqual({
      ok: false,
      say: "Ending the run is the host's.",
    });
  });
});

describe("two members with the same name", () => {
  // Two Adas, and only the third seat acts this unit: the account id is
  // the only thing that tells the press apart.
  const twins = [
    { sub: "owner", role: "owner" as const, joinedAt: "2026-09-01T00:00:00Z", name: "Mo" },
    { sub: "ada", role: "player" as const, joinedAt: "2026-09-02T00:00:00Z", name: "Ada" },
    { sub: "ada-too", role: "player" as const, joinedAt: "2026-09-03T00:00:00Z", name: "Ada" },
  ];
  const turns = packWith({
    players: {
      min: 3,
      max: 4,
      roles: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C", acts: true },
      ],
    },
  });
  const seating = seatingOf(turns, state("m", 3), twins, "owner");

  it("seats each of them, and the name finds only the one who sat down first", () => {
    expect([...seating.seats]).toEqual([
      ["owner", 1],
      ["ada", 2],
      ["ada-too", 3],
    ]);
    expect(seating.names.get("Ada")).toBe(2);
    expect(seating.acting).toEqual([3]);
  });

  it("lands a press on the seat its account holds, not the seat its name finds", () => {
    expect(seatMay({ press: "primary", seat: "Ada", who: "ada-too" }, seating)).toBe(null);
    expect(seatMay({ press: "primary", seat: "Ada", who: "ada" }, seating)).toEqual({
      ok: false,
      say: "It is not your turn to press that.",
    });
  });
});

describe("the contestant a moderated press names", () => {
  const moderated = seatingOf(packWith({ moderated: { contestants: { min: 2, max: 10 } } }), state(), members, "owner");

  it("gives the name once the account is a member", () => {
    expect(contestantName({ seat: "Ada", who: "ada" }, moderated)).toBe("Ada");
  });

  it("gives nothing for an account that is not one, whatever name it carries", () => {
    expect(contestantName({ seat: "Ada", who: "stranger" }, moderated)).toBe(null);
    expect(contestantName({ seat: "Nobody" }, moderated)).toBe(null);
  });
});
