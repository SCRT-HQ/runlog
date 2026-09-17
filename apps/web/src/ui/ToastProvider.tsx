import type { ReactNode } from "react";
import { ToastContext, useToastSlot } from "./Toast.tsx";

/**
 * One place for the app to say what just happened.
 *
 * Before this, every page that wanted a line owned one: the run's own view
 * and the people panel each held a slot, both drew at the same place on the
 * screen, and whichever of the two spoke second was painted over the first.
 * The slot belongs to the app, not to whatever part of it has news, so it
 * is held at the root and everything below asks for it by name.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useToastSlot();
  return (
    <ToastContext.Provider value={toast.show}>
      {children}
      {toast.node}
    </ToastContext.Provider>
  );
}
