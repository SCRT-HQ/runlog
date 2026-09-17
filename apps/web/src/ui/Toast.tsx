import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * A line that says something happened and then goes away.
 *
 * The app has said things in place until now, under the thing that did
 * them. A deck attaching has no place of its own: the press came from
 * across the room, and the person who made it is looking at the game.
 * Five seconds, `role="status"` so it is read out rather than announced,
 * and no buttons: nothing here is worth interrupting for.
 *
 * There is one slot for the whole app, held by `ToastProvider` at the
 * root. `useToast` finds it and hands back the provider's `show` with no
 * node to place, so two callers on one screen cannot each draw a line of
 * their own. Where there is no provider, which is a page rendered on its
 * own and every test that renders one component, the hook keeps its own
 * slot and behaves exactly as it did before.
 */

/** The app's one slot, offered by `ToastProvider`; null on a tree that has none. */
export const ToastContext = createContext<((text: string) => void) | null>(null);

export interface Toast {
  show: (text: string) => void;
  /** Where the line is drawn. Null when the provider is drawing it instead. */
  node: ReactNode;
}

/** One slot and its clock. The provider holds one of these; so does a page with no provider above it. */
export function useToastSlot(): Toast {
  // A second `show` of the same words is still a second thing happening,
  // and wants its own five seconds -- keying state on the text alone made
  // the two calls look like one to React, which left the clock unmoved.
  // The counter makes every `show` its own object, so the effect below
  // always sees a change and restarts the timer.
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [note]);
  const show = useCallback((next: string) => setNote((prev) => ({ text: next, n: (prev?.n ?? 0) + 1 })), []);
  const node =
    note === null ? null : (
      <div className="toast" role="status">
        {note.text}
      </div>
    );
  return { show, node };
}

export function useToast(): Toast {
  const shared = useContext(ToastContext);
  // Both are called every render, whichever one is used: a hook cannot be
  // skipped because of what a context happens to hold today.
  const own = useToastSlot();
  return shared === null ? own : { show: shared, node: null };
}
