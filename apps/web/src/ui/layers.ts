import { useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/**
 * Which layer is on top, so one Escape closes one thing.
 *
 * A dialog, a menu opened inside it and a confirm over both all listen
 * for Escape on the way out of the page, and without an order between
 * them a single press closes all three. Each layer registers while it is
 * open, and only the last one to open answers the key.
 */
export type LayerPriority = "default" | "required";

interface Layer {
  token: object;
  priority: LayerPriority;
}

const stack: Layer[] = [];
const modals: (Layer & { pageOpener: HTMLElement | null })[] = [];
const modalListeners = new Set<() => void>();
let modalRevision = 0;

const weight = (priority: LayerPriority): number => (priority === "required" ? 1 : 0);

function topOf(layers: Layer[]): object | null {
  let top: Layer | undefined;
  for (const layer of layers) {
    if (!top || weight(layer.priority) >= weight(top.priority)) top = layer;
  }
  return top?.token ?? null;
}

function announceModalChange(): void {
  modalRevision += 1;
  for (const listener of modalListeners) listener();
}

/** Registers an open layer, and gives back a check for being the top one. */
export function useLayer(open: boolean, priority: LayerPriority = "default"): () => boolean {
  const self = useRef({});
  useEffect(() => {
    if (!open) return;
    const mine = { token: self.current, priority };
    stack.push(mine);
    return () => {
      const at = stack.lastIndexOf(mine);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [open, priority]);
  return useCallback(() => topOf(stack) === self.current, []);
}

/**
 * Registers a modal separately from ordinary menus and popovers.
 *
 * A menu may own Escape without suspending the enclosing dialog's page
 * isolation. Among modal traps, only this reactive winner may own inertness,
 * scroll locking and focus containment.
 */
export function useModalLayer(
  open: boolean,
  priority: LayerPriority,
  opener: RefObject<HTMLElement | null>,
): { active: boolean; revision: number; pageOpener: RefObject<HTMLElement | null> } {
  const self = useRef({});
  const pageOpener = useRef<HTMLElement | null>(null);
  const revision = useSyncExternalStore(
    useCallback((listener) => {
      modalListeners.add(listener);
      return () => modalListeners.delete(listener);
    }, []),
    () => modalRevision,
    () => 0,
  );

  useEffect(() => {
    if (!open) return;
    // Every participant retains the page origin, even when the first modal
    // closes before a later, lower-priority dialog is allowed to activate.
    const firstModal = modals[0];
    pageOpener.current = firstModal ? firstModal.pageOpener : opener.current;
    const mine = { token: self.current, priority, pageOpener: pageOpener.current };
    modals.push(mine);
    announceModalChange();
    return () => {
      const at = modals.lastIndexOf(mine);
      if (at >= 0) modals.splice(at, 1);
      announceModalChange();
    };
  }, [open, priority, opener]);

  return { active: topOf(modals) === self.current, revision, pageOpener };
}

/** Used while restoring focus after a modal has actually closed. */
export function hasActiveModal(): boolean {
  return topOf(modals) !== null;
}
