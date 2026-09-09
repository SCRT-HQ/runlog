import { useEffect, type RefObject } from "react";

/**
 * Closes something that popped open over the page.
 *
 * Escape closes it, and so does a pointerdown anywhere outside `ref`. Lifted
 * out of PersonaSwitcher, which had grown this on its own, so every popover
 * dismisses the same way instead of each learning its own rules, or, as the
 * account menu did, none at all: it stayed open across a page change with no
 * way to close it but its own toggle.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open, ref, onClose]);
}
