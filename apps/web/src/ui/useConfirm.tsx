import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Asking before something irreversible, in the app's own dialog.
 *
 * `window.confirm` was doing this, and it is the one piece of the
 * interface the app has no say over: the browser draws it, names the
 * host at the top, uses its own buttons and its own words for them, and
 * pins it to the top of the window rather than to the thing being acted
 * on. A run being discarded was announced by a grey box
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
  /** Whatever had focus when the question was asked, to give it back. */
  const opener = useRef<HTMLElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);

  const ask = useCallback((question: Question | string) => {
    opener.current = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    setOpen(typeof question === "string" ? { ask: question } : question);
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
    });
  }, []);

  const close = useCallback((yes: boolean) => {
    setOpen(null);
    answer.current?.(yes);
    answer.current = null;
    // Back where they were, so the next key press goes somewhere sensible.
    opener.current?.focus?.();
    opener.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The button that does the thing takes focus, so Enter answers the
  // question rather than pressing whatever was behind the dialog.
  useEffect(() => {
    if (open) confirmButton.current?.focus();
  }, [open]);

  const dialog = open ? (
    <div className="veil" role="presentation" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <section
        className="panel confirmDialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmAsk"
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
          <button className="ghost" onClick={() => close(false)}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  ) : null;

  return { dialog, ask };
}
