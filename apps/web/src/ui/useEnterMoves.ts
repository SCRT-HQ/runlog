import { useEffect } from "react";

/**
 * Enter makes the move.
 *
 * A screen that is waiting on one thing should take the keyboard's plainest
 * answer for it: read the step, press Enter, read the next one, without a
 * hand leaving the keys to find a button. The move is whichever enabled
 * primary sits in a `stepAction`, the wrapper the one onward button of a
 * screen wears. Where a screen has two of them, or none, Enter does nothing:
 * a default that guesses which button you meant is worse than no default,
 * and the screens that would guess are the ones with something to lose.
 *
 * Anything that already means something by Enter keeps it, so a field, a
 * button, a link, a summary, a select and an editable node are all left
 * alone, as is everything while a dialog or the run's own sheet is open.
 */
export function useEnterMoves(on = true): void {
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const from = event.target as Element | null;
      if (from?.closest?.("input, textarea, select, button, a[href], summary, [contenteditable], [role='dialog']")) return;
      if (document.querySelector("[role='dialog'], .veil, .runBar.open")) return;
      const moves = document.querySelectorAll<HTMLButtonElement>(".stepAction > .primary:not(:disabled)");
      if (moves.length !== 1) return;
      event.preventDefault();
      moves[0]!.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
}
