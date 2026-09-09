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
