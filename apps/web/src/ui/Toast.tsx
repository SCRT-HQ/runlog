import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * A line that says something happened and then goes away.
 *
 * The app has said things in place until now, under the thing that did
 * them. A deck attaching has no place of its own: the press came from
 * across the room, and the person who made it is looking at the game.
 * Five seconds, `role="status"` so it is read out rather than announced,
 * and no buttons: nothing here is worth interrupting for.
 */
export function useToast(): { show: (text: string) => void; node: ReactNode } {
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
