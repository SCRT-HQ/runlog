import type { Pack } from "@runlog/rules-schema";
import { actingSeats, moderation, playerConfig, type RunState } from "@runlog/engine";
import type { Press, Verdict } from "./takePress.ts";

/**
 * Who is at this table, and what each of them may press.
 *
 * A press from a seat is somebody other than the owner asking the owner's
 * page to do something. What that means is the pack's business, not the
 * server's: a solo pack has one seat and it is the owner's, a moderated
 * pack has a moderator at the device and contestants who are names rather
 * than accounts, and a table pack has players whose turn to act the mode's
 * roles decide. So this reads the mode, the same functions the run screen
 * reads, and says yes or no in words a strip can show.
 */

export type SeatKind = "solo" | "moderated" | "table";

export interface Seating {
  kind: SeatKind;
  /** The seats that may take the table's actions this unit; null means every seat may. */
  acting: number[] | null;
  /**
   * Each member's seat, by account id. The owner is seat 1.
   *
   * By id rather than by name because a name is what people call each
   * other and two of them can be the same, while the id is the server's
   * own word for who signed the press. A member with no name on file is
   * seated all the same.
   */
  seats: Map<string, number>;
  /**
   * The same seats by display name, for a press from before the server
   * carried the id. Ambiguous where two members share a name, which is
   * the reason the id came along.
   */
  names: Map<string, number>;
}

/** Which of the three shapes this run is being played in. */
export function seatKindOf(pack: Pack, state: RunState | null): SeatKind {
  if (moderation(pack, state)) return "moderated";
  const config = playerConfig(pack, state);
  if (config && Math.max(config.max ?? 1, state?.players ?? 1) > 1) return "table";
  return "solo";
}

/**
 * The table, from the run's members.
 *
 * Seats are numbered in joining order with the owner first, which is the
 * order everyone sat down in and the order the engine's rotation counts
 * round. Watchers are not seated: they watch.
 */
export function seatingOf(
  pack: Pack,
  state: RunState | null,
  members: ReadonlyArray<{ sub: string; role: "owner" | "player" | "viewer"; joinedAt: string; name?: string }>,
  ownerSub: string,
): Seating {
  const kind = seatKindOf(pack, state);
  const players = members
    .filter((m) => m.role === "owner" || m.role === "player")
    .sort((a, b) => (a.sub === ownerSub ? -1 : b.sub === ownerSub ? 1 : a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0));
  const seats = new Map<string, number>();
  const names = new Map<string, number>();
  players.forEach((m, index) => {
    seats.set(m.sub, index + 1);
    // First one wins, so a press with no id behind it lands on the member
    // who sat down first. Two members sharing a name is exactly the case
    // the id settles.
    if (m.name && !names.has(m.name)) names.set(m.name, index + 1);
  });
  // A solo pack and a moderated one are played from one device, so one seat
  // acts and it is the owner's. A table pack asks the mode's roles, and a
  // mode that marks none lets any seat act.
  const acting = kind === "table" ? actingSeats(pack, state) : [1];
  return { kind, acting, seats, names };
}

/**
 * The seat this press was made from, or null where it was made from none.
 *
 * The account id first, because the server sets it from the token it
 * verified and nothing the client sends can change it. The name only
 * where there is no id: a press forwarded by a build from before the
 * field existed.
 */
function seatOf(press: Pick<Press, "seat" | "who">, seating: Seating): number | null {
  if (press.who) return seating.seats.get(press.who) ?? null;
  if (press.seat) return seating.names.get(press.seat) ?? null;
  return null;
}

/**
 * The name to find this press's contestant by, on a moderated pack.
 *
 * A contestant is a name on a roster rather than an account, so the name
 * is still what finds the row. The id is what says the press may be
 * there at all, which is why it is checked first: null where the account
 * is not a member, whatever name the press carries.
 */
export function contestantName(press: Pick<Press, "seat" | "who">, seating: Seating): string | null {
  if (seatOf(press, seating) === null) return null;
  return press.seat ?? null;
}

/**
 * Whether this press is this seat's to make, and why not where it is not.
 *
 * Read before the offer is, so a seat that cannot act is told the same
 * thing whatever it pressed and whatever the run happens to be offering.
 */
export function seatMay(press: Pick<Press, "press" | "answer" | "seat" | "who">, seating: Seating): Verdict | null {
  const seat = seatOf(press, seating);
  if (seat === null) return { ok: false, say: "You are not at this table." };
  // The host's own device settings and the shape of the run, whatever the
  // mode: the same split the server keeps for the setup and the command.
  if (press.press === "undo") return { ok: false, say: "Taking a move back is the host's." };
  if (press.press === "answer") {
    const answer = press.answer ?? {};
    if (typeof answer["setup"] === "string") return { ok: false, say: "Handing out a setup is the host's." };
    if (typeof answer["command"] === "string") return { ok: false, say: "Handing out a command is the host's." };
    if (typeof answer["clock"] === "string") return { ok: false, say: "The clock is the host's." };
    if (typeof answer["autoRoll"] === "boolean") return { ok: false, say: "Rolling for the table is the host's." };
    if (answer["finish"] === true) return { ok: false, say: "Ending the run is the host's." };
    // A tally, a dial, a typed answer and a ticked list are the table's,
    // and a seat is at the table.
    return null;
  }
  if (press.press === "primary" || press.press === "move") {
    if (seating.acting !== null && !seating.acting.includes(seat)) {
      return { ok: false, say: seating.kind === "table" ? "It is not your turn to press that." : "The host presses that on this pack." };
    }
    return null;
  }
  return { ok: false, say: "This run does not know that press." };
}
