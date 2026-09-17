import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "./useFocusTrap.ts";

/**
 * Asking before something irreversible, in the app's own dialog.
 *
 * `window.confirm` was doing this, and it is the one piece of the
 * interface the app has no say over: the browser draws it, names the
 * host at the top, uses its own buttons and its own words for them, and
 * pins it to the top of the window rather than to the thing being acted
 * on. A run being discarded was announced by a gray box
 * naming the host it came from.
 *
 * It also blocks. `confirm` stops the page: timers stop, the socket's
 * messages queue, and a run waiting on the server sits there until
 * somebody answers. A dialog of our own is just state.
 *
 * What it has to keep from the native one, because these are the reasons
 * `confirm` is still worth using:
 *
 *  - Escape cancels, and so does a click on the veil.
 *  - Focus moves into the dialog, and back to whatever opened it.
 *  - Enter answers the focused button rather than the page behind it.
 *  - Nothing in the page behind reacts while it is open.
 *
 * Used as a pair: render `dialog` somewhere in the tree, and `ask` gives
 * back a promise that answers true or false.
 */
export interface Question {
  /** The question itself, short enough to read in one line. */
  ask: string;
  /** What happens if they say yes, where it is worth spelling out. */
  detail?: string;
  /** The word on the button that does the thing. "Discard", not "OK". */
  confirm?: string;
  /** Marks the action as one that destroys something, for the button's look. */
  destructive?: boolean;
}

export function useConfirm(): { dialog: ReactNode; ask: (question: Question | string) => Promise<boolean> } {
  const [open, setOpen] = useState<Question | null>(null);
  /** Kept in a ref so a re-render cannot lose the promise mid-question. */
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const panel = useRef<HTMLElement>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  /** False until the dialog has been on screen for a frame; see the Enter guard below. */
  const seen = useRef(false);

  const ask = useCallback((question: Question | string) => {
    setOpen(typeof question === "string" ? { ask: question } : question);
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
    });
  }, []);

  const close = useCallback((yes: boolean) => {
    setOpen(null);
    answer.current?.(yes);
    answer.current = null;
  }, []);
  const cancel = useCallback(() => close(false), [close]);

  /**
   * Focus lands on the answer, so Enter answers the question rather than
   * pressing whatever was behind the veil. Where the answer destroys
   * something it lands on Cancel instead: the safe one is the one a
   * reflex should press. The trap holds focus in the dialog, keeps the
   * page behind it out of the tab order, and gives focus back on the way
   * out.
   */
  useFocusTrap(panel, open !== null, cancel, open?.destructive ? cancelButton : confirmButton);

  /**
   * A dialog that opens under a finger already coming down on Enter must
   * not answer itself. Nothing is confirmed until it has had a frame on
   * screen, which is long enough to have been seen and short enough that
   * nobody deliberate notices.
   */
  useEffect(() => {
    seen.current = false;
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      seen.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const dialog = open ? (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <section
        className="panel confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmAsk"
        tabIndex={-1}
        ref={panel}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !seen.current) e.preventDefault();
        }}
        {...(open.detail ? { "aria-describedby": "confirmDetail" } : {})}
      >
        <h2 id="confirmAsk">{open.ask}</h2>
        {open.detail && (
          <p id="confirmDetail" className="muted small">
            {open.detail}
          </p>
        )}
        <div className="padRow confirmActions">
          <button ref={confirmButton} className={`primary${open.destructive ? " danger" : ""}`} onClick={() => close(true)}>
            {open.confirm ?? "Yes"}
          </button>
          <button ref={cancelButton} className="ghost" onClick={() => close(false)}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { dialog, ask };
}
