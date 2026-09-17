import { useEffect, useRef, type RefObject } from "react";
import { useLayer } from "./layers.ts";

/**
 * Holds a modal dialog's keyboard inside it.
 *
 * `aria-modal` says a dialog is modal and isolates nothing: the page
 * behind it keeps its place in the tab order, and five presses of
 * Shift+Tab out of the run's Settings landed on a tracker button under
 * the veil. So the trap does the four things the attribute only claims.
 * Focus starts where the dialog says, Tab and Shift+Tab cycle inside it,
 * everything beside the dialog is `inert` while it is open, and focus
 * goes back to whatever opened it. Escape is the top layer's alone, so a
 * menu opened inside the dialog closes on the first press and the dialog
 * on the second.
 *
 * The native `<dialog>` element does most of this in a browser, and none
 * of it in jsdom 30, which has no `showModal` at all: the tests would
 * then be exercising a polyfill rather than the app. See the task report.
 */
const CANDIDATES = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "details > summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/** Everything inside `root` a Tab press can reach, in the order it reaches them. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
    if (el.tabIndex < 0) return false;
    if (el.closest("[inert]") !== null || el.closest("[hidden]") !== null) return false;
    // Whether a box is drawn at all is a question only a browser can
    // answer; jsdom has no layout, so there it counts as shown.
    return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
  });
}

/**
 * Makes everything outside the dialog inert, and holds the page behind it
 * still. Only the panel's own ancestors stay live, so the dialog can sit
 * anywhere in the tree rather than having to be portaled to the body.
 */
function holdBackground(panel: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (let node: HTMLElement | null = panel; node && node !== document.body; node = node.parentElement) {
    for (const beside of Array.from(node.parentElement?.children ?? [])) {
      if (beside === node || beside.hasAttribute("inert")) continue;
      beside.setAttribute("inert", "");
      undo.push(() => beside.removeAttribute("inert"));
    }
  }
  // A phone scrolls the page under the veil otherwise, and comes back to
  // a dialog floating over somewhere else.
  const scrolled = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  undo.push(() => {
    document.body.style.overflow = scrolled;
  });
  return () => {
    for (const step of undo) step();
  };
}

/** Back where they were, or, if the dialog outlived it, to the page itself. */
function giveFocusBack(opener: HTMLElement | null): void {
  if (opener?.isConnected && typeof opener.focus === "function") {
    opener.focus();
    return;
  }
  const landing = document.querySelector<HTMLElement>("main") ?? document.body;
  if (!landing.hasAttribute("tabindex")) {
    landing.setAttribute("tabindex", "-1");
    landing.addEventListener("blur", () => landing.removeAttribute("tabindex"), { once: true });
  }
  landing.focus();
}

export function useFocusTrap(
  /** The dialog itself, which must be focusable so it can hold focus when it has no controls. */
  panel: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  /** What takes focus when it opens; the first control it holds, where this is absent. */
  initial?: RefObject<HTMLElement | null>,
): void {
  const top = useLayer(open);
  // Read at open rather than tracked, so a re-render cannot restart the
  // dialog by handing the effect a new object.
  const first = useRef(initial);
  first.current = initial;

  /**
   * Whatever had focus when the dialog opened, taken while the page is
   * still the one it opened over. An effect is too late: a control that
   * opens a dialog and is removed by the same press has already gone by
   * the time effects run, and focus with it.
   */
  const opener = useRef<HTMLElement | null>(null);
  if (open && opener.current === null && typeof document !== "undefined") {
    const held = document.activeElement as HTMLElement | null;
    opener.current = held && held !== document.body ? held : null;
  }

  useEffect(() => {
    // Forgotten when it shuts rather than on the way out, so that a
    // development build, which mounts every effect twice, does not throw
    // the opener away between the two.
    if (!open) {
      opener.current = null;
      return;
    }
    const box = panel.current;
    if (!box) return;
    const release = holdBackground(box);
    (first.current?.current ?? focusables(box)[0] ?? box).focus();
    return () => {
      release();
      giveFocusBack(opener.current);
    };
  }, [open, panel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const box = panel.current;
      if (!box || !top()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const stops = focusables(box);
      e.preventDefault();
      if (stops.length === 0) {
        box.focus();
        return;
      }
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === -1 || at === stops.length - 1 ? 0 : at + 1;
      stops[next]?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, panel, onClose, top]);
}
