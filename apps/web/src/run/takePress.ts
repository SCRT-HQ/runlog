import type { Offer } from "./offer.ts";
import { seatMay, type Seating } from "./seats.ts";

export interface Press {
  from: string;
  run: string;
  seq: number;
  ref: string;
  press: string;
  /**
   * Who pressed it, where it was not the owner's own hand: a seated
   * member's name, as the run's members hold it. For display, and for a
   * moderated pack's roster, which goes by name. A deck carries none.
   */
  seat?: string;
  /**
   * The account behind that name, as the server read it off the token it
   * verified. What the seat is actually looked up by; the name is only
   * read where this is absent.
   */
  who?: string;
  move?: string;
  answer?: Record<string, unknown>;
}

export interface Verdict {
  ok: boolean;
  say?: string;
}

export interface Acts {
  primary: () => void;
  move: (id: string) => void;
  undo: () => void;
  answer: (answer: Record<string, unknown>) => void;
  setup: (id: string) => void | Promise<void>;
  /** Hand the attached tool one setup's operations, leaving the run alone. */
  command: (id: string) => void | Promise<void>;
  /** Move a tally or a dial, by a step or to a number. */
  tracker: (id: string, move: { by: number } | { to: number }) => void;
  clock: (id: string, doing: "pause" | "resume" | "stop") => void;
  autoRoll: (on: boolean) => void;
  finish: () => void;
}

/**
 * Whether a press from outside may be taken, and taking it.
 *
 * Given everything it decides on, because this is the one place a run
 * can be moved by something that is not looking at it. Two rules do the
 * work. A press names the offer it was drawn from, so one made while
 * the unit was closing cannot roll into the next unit. And a press
 * names itself and who sent it, so two decks racing for the same button
 * each move it once, and one deck retried after an answer that never
 * arrived moves it only once.
 *
 * Not total, though: an `act` may throw, most likely a write raced by
 * another device. That still spends the ref and settles a verdict --
 * the deck is told the press failed rather than left waiting on one
 * that will never answer.
 */
export function takePress(
  press: Press,
  at: { seq: number; offer: Offer; seen: Map<string, Verdict>; seating: Seating },
  act: Acts,
): Verdict {
  const key = `${press.from}:${press.ref}`;
  const already = at.seen.get(key);
  if (already) return already;

  const settle = (verdict: Verdict): Verdict => {
    at.seen.set(key, verdict);
    return verdict;
  };

  if (press.seq !== at.seq) return settle({ ok: false, say: "That moved on." });

  // A seat's press is checked against the table before the offer is read:
  // a press that is not this seat's to make is refused in the same words
  // whatever the run is offering at that moment.
  if (press.seat || press.who) {
    const said = seatMay(press, at.seating);
    if (said) return settle(said);
  }

  /**
   * Taking the press itself: a throw is still a press taken, not one left
   * hanging. In the act's own words where it threw any, because an act is
   * the only thing that can see why -- a list still wanting the page, say.
   */
  const take = (fn: () => void): Verdict => {
    try {
      fn();
      return { ok: true };
    } catch (e) {
      const said = e instanceof Error ? e.message.trim() : "";
      return { ok: false, say: said === "" ? "That press failed." : said };
    }
  };

  switch (press.press) {
    case "primary": {
      if (!at.offer.primary) return settle({ ok: false, say: at.offer.needsPage ?? "There is nothing to press." });
      return settle(take(() => act.primary()));
    }
    case "move": {
      const id = press.move ?? "";
      if (!at.offer.moves.some((m) => m.id === id)) return settle({ ok: false, say: "That is not on offer." });
      return settle(take(() => act.move(id)));
    }
    case "undo": {
      if (!at.offer.undo) return settle({ ok: false, say: "There is nothing to take back." });
      return settle(take(() => act.undo()));
    }
    case "answer": {
      // Play on under a different setup: the page's own picker and its
      // "Hand it out" in one press, which is what a key on a deck is for.
      // It rides in the answer because that is the only field of a press
      // the server passes through, and it names a setup by id, so it is
      // checked against the offer the way a move is.
      const named = press.answer?.["setup"];
      if (typeof named === "string") {
        if (!at.offer.setups.some((s) => s.id === named)) return settle({ ok: false, say: "That setup is not here." });
        return settle(take(() => act.setup(named)));
      }
      // The other thing a setup file can mean: hand it to the tool now
      // and leave the run under what it was already being played under.
      // Named by id from its own list, because the two lists hold the
      // same ids and a deck laying out both kinds of key checks each
      // press against the list the key was drawn from.
      const command = press.answer?.["command"];
      if (typeof command === "string") {
        if (!at.offer.commands.some((c) => c.id === command)) return settle({ ok: false, say: "That command is not here." });
        return settle(take(() => act.command(command)));
      }
      /*
       * The four things on the page that are not the step: a tally or a
       * dial, the unit's clock, the dice setting, and the end of the run.
       * None of them answers what the step is asking, so each is checked
       * against the offer on its own and taken ahead of the presets below,
       * the way a setup is.
       */
      const tracker = press.answer?.["tracker"];
      if (typeof tracker === "string") {
        if (!at.offer.trackers.some((t) => t.id === tracker)) return settle({ ok: false, say: "That tracker is not here." });
        // How far to move it, or where to land it: a pair of − and + keys
        // sends `by`, a key that stands for a value sends `to`. What either
        // comes to against the run's own floor and ceiling is the act's to
        // settle, exactly as the panel's own buttons leave it to the run.
        const by = press.answer?.["by"];
        const to = press.answer?.["to"];
        if (typeof by === "number" && Number.isInteger(by)) return settle(take(() => act.tracker(tracker, { by })));
        if (typeof to === "number" && Number.isInteger(to)) return settle(take(() => act.tracker(tracker, { to })));
        return settle({ ok: false, say: "This run does not know that press." });
      }
      const clock = press.answer?.["clock"];
      if (typeof clock === "string") {
        const doing = press.answer?.["do"];
        const ticking = at.offer.clock;
        if (!ticking || ticking.id !== clock) return settle({ ok: false, say: "That clock is not here." });
        if (doing !== "pause" && doing !== "resume" && doing !== "stop")
          return settle({ ok: false, say: "This run does not know that press." });
        // Each of the three means something only from where the clock
        // already is. The page shows one button or the other for that
        // reason; a deck holding all three at once is told which it was.
        if (doing === "pause" && ticking.status !== "running") return settle({ ok: false, say: "That clock is not running." });
        if (doing === "resume" && ticking.status !== "paused") return settle({ ok: false, say: "That clock is not paused." });
        if (doing === "stop" && ticking.status === "done") return settle({ ok: false, say: "That clock has stopped." });
        return settle(take(() => act.clock(clock, doing)));
      }
      // Throwing the dice for the player is a setting rather than an
      // answer, so nothing here refuses it: a key that only ever sends
      // `true` is as good as one that toggles, and setting it to what it
      // already is leaves the run where it was.
      const auto = press.answer?.["autoRoll"];
      if (typeof auto === "boolean") return settle(take(() => act.autoRoll(auto)));
      // The end of the run, which the page offers only from its closing
      // step and only where the run may actually end. The offer carries
      // that button's own words, so a key face can say them.
      if (press.answer?.["finish"] === true) {
        if (!at.offer.ending) return settle({ ok: false, say: "The run cannot end here." });
        return settle(take(() => act.finish()));
      }
      // Tick everything this step waits for and press its own button. The
      // offer says whether there is a list to tick; the act says whether
      // one of its boxes is beyond a deck, and throws its own words if so.
      if (press.answer?.["ticks"] === "all") {
        if (!at.offer.presets.some((p) => p.kind === "checklist")) return settle({ ok: false, say: "The run is not asking for that." });
        return settle(take(() => act.answer({ ticks: "all" })));
      }
      if (!at.offer.presets.some((p) => p.kind === "declareSubject")) return settle({ ok: false, say: "The run is not asking for that." });
      if (String(press.answer?.["subject"] ?? "").trim() === "") return settle({ ok: false, say: "That answer was empty." });
      return settle(take(() => act.answer(press.answer!)));
    }
    default:
      return settle({ ok: false, say: "This run does not know that press." });
  }
}
