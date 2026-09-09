/**
 * The first box in this step still unticked, brought into view and given
 * focus.
 *
 * Never dim the button that finishes a step: a dimmed Done beside an
 * unticked list reads as broken. Pressing it instead points at the box it is
 * waiting for. Works from any element inside a `.runStep`, in any document: 
 * the page's own and the floating remote's window both carry that class, so
 * this one function serves both without knowing which one it is in.
 */
export function nudgeFirstUnticked(from: HTMLElement): void {
  const box = from.closest(".runStep")?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:checked)');
  if (!box) return;
  box.scrollIntoView({ block: "nearest" });
  box.focus();
}

/**
 * What the unit still owes, brought into view.
 *
 * Same argument as the box above: a dimmed "Settle what is owed first" says
 * a thing is owed and gives no way to reach it, and an obligation that came
 * due at the close was not even on the screen to settle. Pressing the button
 * takes the player to the debt.
 */
export function nudgeOwed(from: HTMLElement): void {
  const owed = from.closest(".main, body")?.querySelector<HTMLElement>(".panel.owed");
  if (!owed) return;
  owed.scrollIntoView({ block: "nearest", behavior: "smooth" });
  owed.querySelector<HTMLButtonElement>("button.primary")?.focus();
}
