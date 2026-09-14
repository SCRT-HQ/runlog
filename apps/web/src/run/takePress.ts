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
 * Pure, and given everything it decides on, because this is the one
 * place a run can be moved by something that is not looking at it. Two
 * rules do the work. A press names the offer it was drawn from, so one
 * made while the unit was closing cannot roll into the next unit. And a
 * press names itself, so a deck that pressed twice in a breath, or
 * retried after an answer that never arrived, moves the run once.
 */
export function takePress(press: Press, at: { seq: number; offer: Offer; seen: Map<string, Verdict> }, act: Acts): Verdict {
  const already = at.seen.get(press.ref);
  if (already) return already;

  const settle = (verdict: Verdict): Verdict => {
    at.seen.set(press.ref, verdict);
    return verdict;
  };

  if (press.seq !== at.seq) return settle({ ok: false, say: "That moved on." });

  switch (press.press) {
    case "primary": {
      if (!at.offer.primary) return settle({ ok: false, say: at.offer.needsPage ?? "There is nothing to press." });
      act.primary();
      return settle({ ok: true });
    }
    case "move": {
      const id = press.move ?? "";
      if (!at.offer.moves.some((m) => m.id === id)) return settle({ ok: false, say: "That is not on offer." });
      act.move(id);
      return settle({ ok: true });
    }
    case "undo": {
      if (!at.offer.undo) return settle({ ok: false, say: "There is nothing to take back." });
      act.undo();
      return settle({ ok: true });
    }
    case "answer": {
      if (!press.answer) return settle({ ok: false, say: "That answer was empty." });
      act.answer(press.answer);
      return settle({ ok: true });
    }
    default:
      return settle({ ok: false, say: "This run does not know that press." });
  }
}
