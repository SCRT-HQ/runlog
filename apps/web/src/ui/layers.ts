import { useCallback, useEffect, useRef } from "react";

/**
 * Which layer is on top, so one Escape closes one thing.
 *
 * A dialog, a menu opened inside it and a confirm over both all listen
 * for Escape on the way out of the page, and without an order between
 * them a single press closes all three. Each layer registers while it is
 * open, and only the last one to open answers the key.
 */
const stack: object[] = [];

/** Registers an open layer, and gives back a check for being the top one. */
export function useLayer(open: boolean): () => boolean {
  const self = useRef({});
  useEffect(() => {
    if (!open) return;
    const mine = self.current;
    stack.push(mine);
    return () => {
      const at = stack.lastIndexOf(mine);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [open]);
  return useCallback(() => stack.length > 0 && stack[stack.length - 1] === self.current, []);
}
