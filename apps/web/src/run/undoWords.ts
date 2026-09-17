import type { Pack } from "@runlog/rules-schema";
import type { RunEvent } from "@runlog/engine";
import { effectiveEvents, undoableIds } from "@runlog/engine";
import { isBoundary } from "./useRun.ts";

/**
 * What Undo would take back, in the pack's own words.
 *
 * The button said "Undo" and nothing more, and what it takes back is a whole
 * move rather than a keystroke: the roll, the step, the round just entered.
 * The name comes from the pack, the same name the log and the step's own
 * head use, so the title never invents a word for something already named.
 * Where nothing in the run names what is about to go, it says so plainly
 * instead of guessing.
 *
 * Read off the same batch `run.undo` would void, so the word and the deed
 * cannot come apart.
 */
export function undoWords(pack: Pack, events: readonly RunEvent[]): string {
  const plain = "Undo the last thing";
  const first = undoableIds(events, isBoundary)[0];
  const move = first === undefined ? undefined : events.find((e) => e.id === first);
  if (!move) return plain;
  const named = (name: string | undefined) => (name ? `Undo ${name}` : plain);
  switch (move.t) {
    case "Rolled":
      return named(pack.tables[move.purpose]?.title);
    case "StepCompleted": {
      const step = pack.phases.find((p) => p.id === move.phase)?.steps[move.step];
      return named(step && "label" in step ? step.label : undefined);
    }
    case "UnitEntered":
      // The move being undone is always the newest, so the unit it entered
      // is the last one the log has.
      return `Undo ${pack.vocabulary.unit.one} ${effectiveEvents(events).filter((e) => e.t === "UnitEntered").length}`;
    case "RunEnded":
      return named(pack.endings?.find((e) => e.id === move.ending)?.label);
    default:
      return plain;
  }
}
