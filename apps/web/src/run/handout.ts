import type { ChosenSetup } from "../control/setups.ts";

/**
 * A handout, on the wire and on the screen.
 *
 * Handing a setup out is the one press at a table whose effect lands
 * somewhere else: the host picks the heavy build, everybody attached is
 * re-equipped, and until now the only person told was the one who
 * pressed the button. The gesture already reached every watcher; it just
 * said nothing about what had been handed out, so nobody could say it.
 *
 * So the press carries the title, and every page that hears it says the
 * same sentence. Two functions rather than one because the two ends are
 * different jobs: what a run knows when it presses, and what a page has
 * when a line arrives from somewhere else.
 */

/** What the `setup` gesture carries: what was handed out. Null where nothing was chosen, which is nothing to announce. */
export function handoutOf(chosen: ChosenSetup | null): { title: string; id?: string } | null {
  const from = chosen?.from ?? [];
  if (from.length === 0) return null;
  const titles = from.map((f) => f.title);
  // Several, where a run was seeded from more than one: said the way the
  // rest of the app says a list. The id goes with a single one only,
  // since there is no single setup to name otherwise.
  const title = titles.length === 1 ? titles[0]! : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
  return { title, ...(from.length === 1 ? { id: from[0]!.id } : {}) };
}

/**
 * What the table is told when one arrives, or null where there is
 * nothing to say: another kind of gesture, or one from a copy of the app
 * older than the title, which is better left silent than announced as
 * something that happened to nothing in particular.
 *
 * `from` is the sender's name, stamped by the server off the member row;
 * a member with no name on file leaves it off, and the host is named for
 * the seat rather than guessed at.
 */
export function handoutLine(gesture: { kind: string; data: Record<string, unknown>; from?: string }): string | null {
  if (gesture.kind !== "setup") return null;
  const title = gesture.data["title"];
  if (typeof title !== "string" || title.trim() === "") return null;
  return `${gesture.from ?? "The host"} handed out ${title.trim()}.`;
}
