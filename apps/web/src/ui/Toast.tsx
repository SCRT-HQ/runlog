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
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (text === null) return;
    const timer = window.setTimeout(() => setText(null), 5000);
    return () => window.clearTimeout(timer);
  }, [text]);
  const show = useCallback((next: string) => setText(next), []);
  const node =
    text === null ? null : (
      <div className="toast" role="status">
        {text}
      </div>
    );
  return { show, node };
}
