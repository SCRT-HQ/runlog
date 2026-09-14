import type { Offer } from "./offer.ts";

export interface Press {
  from: string;
  run: string;
  seq: number;
  ref: string;
  press: string;
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
export function takePress(press: Press, at: { seq: number; offer: Offer; seen: Map<string, Verdict> }, act: Acts): Verdict {
  const key = `${press.from}:${press.ref}`;
  const already = at.seen.get(key);
  if (already) return already;

  const settle = (verdict: Verdict): Verdict => {
    at.seen.set(key, verdict);
    return verdict;
  };

  if (press.seq !== at.seq) return settle({ ok: false, say: "That moved on." });

  /** Taking the press itself: a throw is still a press taken, not one left hanging. */
  const take = (fn: () => void): Verdict => {
    try {
      fn();
      return { ok: true };
    } catch {
      return { ok: false, say: "That press failed." };
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
      if (!at.offer.presets.some((p) => p.kind === "declareSubject")) return settle({ ok: false, say: "The run is not asking for that." });
      if (String(press.answer?.["subject"] ?? "").trim() === "") return settle({ ok: false, say: "That answer was empty." });
      return settle(take(() => act.answer(press.answer!)));
    }
    default:
      return settle({ ok: false, say: "This run does not know that press." });
  }
}
